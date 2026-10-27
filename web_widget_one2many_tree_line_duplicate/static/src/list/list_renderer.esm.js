/** @odoo-module **/
/* Copyright 2024 Tecnativa - Carlos Roca
 * License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl). */

import {ListRenderer} from "@web/views/list/list_renderer";
import {archParseBoolean} from "@web/views/utils";
import {browser} from "@web/core/browser/browser";
import {patch} from "@web/core/utils/patch";
import {x2ManyCommands} from "@web/core/orm_service";

const SCALAR_TYPES = [
    "integer",
    "float",
    "monetary",
    "char",
    "text",
    "html",
    "boolean",
    "selection",
    "date",
    "datetime",
];
const MANY2ONE_TYPES = ["many2one", "many2one_reference", "reference"];

patch(ListRenderer.prototype, {
    setup() {
        super.setup(...arguments);
        const parent = this.__owl__.parent.parent;
        this.keyDuplicateLineColumn = `duplicate_line_column,${this.keyOptionalFields}`;
        this.duplicateLineAllowed = Boolean(
            parent &&
                parent.props &&
                parent.props.fieldInfo &&
                parent.props.fieldInfo.options &&
                parent.props.fieldInfo.options.allow_clone
        );
        // Lists without the option don't touch the local storage at all
        this.duplicateLineColumn =
            this.duplicateLineAllowed &&
            archParseBoolean(
                browser.localStorage.getItem(this.keyDuplicateLineColumn),
                true
            );
    },
    get hasDuplicateLineColumn() {
        // activeActions.create is false when the x2many is readonly
        return (
            this.duplicateLineAllowed &&
            this.duplicateLineColumn &&
            this.isX2Many &&
            Boolean(this.activeActions.create)
        );
    },
    isDuplicableLine(record) {
        return !["line_section", "line_note"].includes(record.data.display_type);
    },
    toggleDuplicateLineColumn() {
        this.duplicateLineColumn = !this.duplicateLineColumn;
        browser.localStorage.setItem(
            this.keyDuplicateLineColumn,
            this.duplicateLineColumn
        );
        this.render();
    },
    get nbCols() {
        let nbCols = super.nbCols;
        if (this.hasDuplicateLineColumn) {
            nbCols++;
        }
        return nbCols;
    },
    /**
     * Snapshot of the record's values, including the readonly computed ones
     * (subtotals...), so the copy is exact. The new line is created running its
     * onchanges, which recompute editable fields (e.g. price_unit from the
     * product) and discard the manual values. We re-apply this snapshot with
     * withoutOnchange so those values are kept.
     *
     * @param {Record} record record to copy the values from
     * @param {StaticList} list list the record belongs to
     * @returns {Object} changes to apply on the copy
     */
    getDuplicateSnapshot(record, list) {
        const snapshot = {};
        for (const [name, value] of Object.entries(record.data)) {
            const field = record.fields[name];
            if (
                !field ||
                name === "id" ||
                name === "display_name" ||
                name === list.handleField ||
                name === list.config.relationField
            ) {
                continue;
            }
            if (SCALAR_TYPES.includes(field.type)) {
                snapshot[name] = value;
            } else if (MANY2ONE_TYPES.includes(field.type)) {
                // Copied as a new array, so both records don't share it
                snapshot[name] = Array.isArray(value) ? [...value] : value;
            } else if (field.type === "many2many") {
                // SET (and not LINK) so the copy ends up with exactly the same
                // records as the source: this way we also drop the ones the
                // onchange added on its own.
                snapshot[name] = [x2ManyCommands.set([...value.currentIds])];
            } else if (field.type === "properties" || field.type === "json") {
                snapshot[name] = value && JSON.parse(JSON.stringify(value));
            }
            // One2many fields can't be set through a snapshot: they are copied
            // sub-record by sub-record in duplicateOne2manyValues().
        }
        return snapshot;
    },
    /**
     * Recreates on the copy the sub-records of every one2many field of the
     * source. The lines the onchanges may have generated on the copy are
     * dropped first, so both records end up with exactly the same content.
     *
     * @param {Record} record source record
     * @param {Record} newRecord copy of the source record
     */
    async duplicateOne2manyValues(record, newRecord) {
        for (const [name, sourceList] of Object.entries(record.data)) {
            const field = record.fields[name];
            if (!field || field.type !== "one2many" || !(name in newRecord.data)) {
                continue;
            }
            const targetList = newRecord.data[name];
            if (
                !Object.keys(sourceList.activeFields).length ||
                !Object.keys(targetList.activeFields).length
            ) {
                // The sub-records have no fields to copy (no sub-view here)
                continue;
            }
            if (targetList.records.length) {
                await targetList._applyCommands(
                    targetList.records.map((line) =>
                        line.resId
                            ? [x2ManyCommands.UNLINK, line.resId]
                            : [x2ManyCommands.DELETE, line._virtualId]
                    )
                );
            }
            for (const line of sourceList.records) {
                const newLine = await targetList._createNewRecordDatapoint({
                    mode: "readonly",
                });
                const snapshot = this.getDuplicateSnapshot(line, targetList);
                if (Object.keys(snapshot).length) {
                    await newLine._update(snapshot, {
                        withoutOnchange: true,
                        withoutParentUpdate: true,
                    });
                }
                await this.duplicateOne2manyValues(line, newLine);
                await targetList._addRecord(newLine, {position: "bottom"});
            }
        }
    },
    /**
     * Adds newRecord to the list right after record. Odoo 17 has no
     * StaticList._duplicateRecords (added later): with a handle field the
     * copy gets the next sequence and the following lines are shifted, as the
     * core does later on; without one the copy is placed after the source.
     *
     * @param {StaticList} list
     * @param {Record} record source record
     * @param {Record} newRecord copy of the source record
     */
    async insertDuplicateAfter(list, record, newRecord) {
        const handleField = list.handleField;
        const index = list.records.indexOf(record) + 1;
        if (handleField && list.canResequence()) {
            let sequence = (record.data[handleField] || 0) + 1;
            await newRecord._update(
                {[handleField]: sequence++},
                {withoutOnchange: true, withoutParentUpdate: true}
            );
            await list._applyCommands(
                list.records
                    .slice(index)
                    .map((line) =>
                        x2ManyCommands.update(line.resId || line._virtualId, {
                            [handleField]: sequence++,
                        })
                    )
            );
            await list._addRecord(newRecord);
            return;
        }
        list.records.splice(index, 0, newRecord);
        list._currentIds.splice(list.offset + index, 0, newRecord._virtualId);
        list._commands.push([x2ManyCommands.CREATE, newRecord._virtualId]);
        list.count++;
        if (list.records.length > list.limit) {
            list._tmpIncreaseLimit++;
            list.model._updateConfig(
                list.config,
                {limit: list.limit + 1},
                {reload: false}
            );
        }
        list._needsReordering = true;
    },
    async onCloneIconClick(record) {
        const list = this.props.list;
        const left = await list.leaveEditMode();
        if (!left) {
            return;
        }
        const snapshot = this.getDuplicateSnapshot(record, list);
        // Everything in a single model transaction, notified once at the end,
        // so the intermediate (onchange-recomputed) values are never rendered.
        await list.model.mutex.exec(async () => {
            const newRecord = await list._createNewRecordDatapoint({
                mode: "readonly",
            });
            if (Object.keys(snapshot).length) {
                await newRecord._update(snapshot, {
                    withoutOnchange: true,
                    withoutParentUpdate: true,
                });
            }
            await this.duplicateOne2manyValues(record, newRecord);
            await this.insertDuplicateAfter(list, record, newRecord);
            await list._onUpdate();
        });
    },
});
