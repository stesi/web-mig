/** @odoo-module **/
/* License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl). */

import {
    click,
    editInput,
    getFixture,
    nextTick,
    patchWithCleanup,
} from "@web/../tests/helpers/utils";
import {makeView, setupViewRegistries} from "@web/../tests/views/helpers";
import {browser} from "@web/core/browser/browser";

let serverData = null;
let target = null;

const LINES_ARCH = `
    <tree editable="bottom">
        <field name="sequence" widget="handle"/>
        <field name="display_type" column_invisible="1"/>
        <field name="name"/>
        <field name="product_id"/>
        <field name="quantity" optional="show"/>
        <field name="price"/>
        <field name="date"/>
        <field name="tag_ids" widget="many2many_tags"/>
    </tree>`;

function rowNames() {
    return [...target.querySelectorAll(".o_data_row .o_data_cell[name=name]")].map(
        (cell) => cell.textContent.trim()
    );
}

function cloneButtons() {
    return target.querySelectorAll(".o_data_row .o_list_duplicate_line button.fa-clone");
}

QUnit.module("web_widget_one2many_tree_line_duplicate", (hooks) => {
    hooks.beforeEach(() => {
        target = getFixture();
        serverData = {
            models: {
                partner: {
                    fields: {
                        name: {string: "Name", type: "char"},
                        line_ids: {
                            string: "Lines",
                            type: "one2many",
                            relation: "line",
                            relation_field: "partner_id",
                        },
                    },
                    records: [{id: 1, name: "Bill", line_ids: [1, 2, 3]}],
                },
                line: {
                    fields: {
                        sequence: {string: "Sequence", type: "integer"},
                        name: {string: "Label", type: "char"},
                        display_type: {
                            string: "Type",
                            type: "selection",
                            selection: [
                                ["product", "Product"],
                                ["line_section", "Section"],
                                ["line_note", "Note"],
                            ],
                            default: "product",
                        },
                        product_id: {
                            string: "Product",
                            type: "many2one",
                            relation: "product",
                        },
                        quantity: {string: "Quantity", type: "float", default: 1},
                        price: {string: "Price", type: "float"},
                        date: {string: "Date", type: "date"},
                        tag_ids: {string: "Tags", type: "many2many", relation: "tag"},
                        partner_id: {
                            string: "Partner",
                            type: "many2one",
                            relation: "partner",
                        },
                    },
                    records: [
                        {
                            id: 1,
                            sequence: 1,
                            name: "Fee",
                            display_type: "product",
                            product_id: 1,
                            quantity: 2,
                            price: 10.5,
                            date: "2026-01-31",
                            tag_ids: [1, 2],
                            partner_id: 1,
                        },
                        {
                            id: 2,
                            sequence: 2,
                            name: "Section",
                            display_type: "line_section",
                            partner_id: 1,
                        },
                        {
                            id: 3,
                            sequence: 3,
                            name: "Refund",
                            display_type: "product",
                            product_id: 2,
                            quantity: 1,
                            price: 3,
                            partner_id: 1,
                        },
                    ],
                },
                product: {
                    fields: {name: {string: "Name", type: "char"}},
                    records: [
                        {id: 1, display_name: "Consulting"},
                        {id: 2, display_name: "Expenses"},
                    ],
                },
                tag: {
                    fields: {name: {string: "Name", type: "char"}},
                    records: [
                        {id: 1, display_name: "Centre A"},
                        {id: 2, display_name: "Centre B"},
                    ],
                },
            },
        };
        setupViewRegistries();
    });

    QUnit.test("clone icon only with allow_clone, not on sections", async (assert) => {
        await makeView({
            type: "form",
            resModel: "partner",
            resId: 1,
            serverData,
            arch: `<form><field name="line_ids" options="{'allow_clone': True}">${LINES_ARCH}</field></form>`,
        });
        assert.containsN(target, ".o_data_row", 3);
        assert.strictEqual(cloneButtons().length, 2, "one icon per product line");
        assert.containsNone(
            target.querySelectorAll(".o_data_row")[1],
            "button.fa-clone",
            "no icon on the section"
        );
        assert.containsOnce(target, "thead th.o_list_duplicate_line");
        assert.strictEqual(
            target.querySelectorAll("tfoot tr td").length,
            target.querySelectorAll("thead tr th").length,
            "footer has a cell for the clone column too"
        );
    });

    QUnit.test("no column without the option", async (assert) => {
        patchWithCleanup(browser.localStorage, {
            getItem(key) {
                assert.notOk(
                    key.startsWith("duplicate_line_column,"),
                    "lists without the option don't read the local storage"
                );
                return super.getItem(key);
            },
        });
        await makeView({
            type: "form",
            resModel: "partner",
            resId: 1,
            serverData,
            arch: `<form><field name="line_ids">${LINES_ARCH}</field></form>`,
        });
        assert.containsNone(target, ".o_list_duplicate_line");
    });

    QUnit.test("no column when the field is readonly", async (assert) => {
        await makeView({
            type: "form",
            resModel: "partner",
            resId: 1,
            serverData,
            arch: `<form><field name="line_ids" readonly="1" options="{'allow_clone': True}">${LINES_ARCH}</field></form>`,
        });
        assert.containsN(target, ".o_data_row", 3);
        assert.containsNone(target, ".o_list_duplicate_line");
    });

    QUnit.test("copy right after the source, same values, saved", async (assert) => {
        let saveCommands = null;
        await makeView({
            type: "form",
            resModel: "partner",
            resId: 1,
            serverData,
            arch: `<form><field name="line_ids" options="{'allow_clone': True}">${LINES_ARCH}</field></form>`,
            mockRPC(route, args) {
                if (args.method === "web_save") {
                    saveCommands = args.args[1].line_ids;
                }
            },
        });
        await click(cloneButtons()[0]);
        assert.deepEqual(rowNames(), ["Fee", "Fee", "Section", "Refund"]);
        const copy = target.querySelectorAll(".o_data_row")[1];
        assert.strictEqual(
            copy.querySelector("[name=product_id]").textContent.trim(),
            "Consulting"
        );
        assert.strictEqual(
            copy.querySelector("[name=quantity]").textContent.trim(),
            "2.00",
            "the manual quantity is kept, not the default"
        );
        assert.strictEqual(copy.querySelector("[name=price]").textContent.trim(), "10.50");
        assert.strictEqual(
            copy.querySelector("[name=date]").textContent.trim(),
            "01/31/2026"
        );
        assert.containsN(copy, ".o_tag", 2, "many2many copied");

        await click(target, ".o_form_button_save");
        const creates = saveCommands.filter((c) => c[0] === 0);
        assert.strictEqual(creates.length, 1);
        const values = creates[0][2];
        assert.strictEqual(values.name, "Fee");
        assert.strictEqual(values.product_id, 1);
        assert.strictEqual(values.quantity, 2);
        assert.strictEqual(values.price, 10.5);
        assert.strictEqual(values.date, "2026-01-31");
        assert.strictEqual(values.sequence, 2, "copy gets the next sequence");
        const updates = Object.fromEntries(
            saveCommands.filter((c) => c[0] === 1).map((c) => [c[1], c[2].sequence])
        );
        assert.deepEqual(updates, {2: 3, 3: 4}, "following lines shifted");
        // reloaded from the server: same order
        assert.deepEqual(rowNames(), ["Fee", "Fee", "Section", "Refund"]);
        assert.containsN(target.querySelectorAll(".o_data_row")[1], ".o_tag", 2);
    });

    QUnit.test("copy of the last line and of an unsaved line", async (assert) => {
        await makeView({
            type: "form",
            resModel: "partner",
            resId: 1,
            serverData,
            arch: `<form><field name="line_ids" options="{'allow_clone': True}">${LINES_ARCH}</field></form>`,
        });
        await click(cloneButtons()[1]);
        assert.deepEqual(rowNames(), ["Fee", "Section", "Refund", "Refund"]);

        await click(target, ".o_field_x2many_list_row_add a");
        await editInput(target, ".o_selected_row [name=name] input", "New line");
        await click(target, ".o_form_view");
        const buttons = cloneButtons();
        await click(buttons[buttons.length - 1]);
        assert.deepEqual(rowNames(), [
            "Fee",
            "Section",
            "Refund",
            "Refund",
            "New line",
            "New line",
        ]);
    });

    QUnit.test("without handle field the copy goes after the source", async (assert) => {
        await makeView({
            type: "form",
            resModel: "partner",
            resId: 1,
            serverData,
            arch: `<form><field name="line_ids" options="{'allow_clone': True}">
                <tree editable="bottom">
                    <field name="display_type" column_invisible="1"/>
                    <field name="name"/>
                    <field name="price"/>
                </tree></field></form>`,
        });
        await click(cloneButtons()[0]);
        assert.deepEqual(rowNames(), ["Fee", "Fee", "Section", "Refund"]);
    });

    QUnit.test("the column can be hidden from the optional columns", async (assert) => {
        const stored = [];
        patchWithCleanup(browser.localStorage, {
            setItem(key, value) {
                stored.push([key, String(value)]);
                super.setItem(key, value);
            },
        });
        await makeView({
            type: "form",
            resModel: "partner",
            resId: 1,
            serverData,
            arch: `<form><field name="line_ids" options="{'allow_clone': True}">${LINES_ARCH}</field></form>`,
        });
        assert.strictEqual(cloneButtons().length, 2);
        await click(target, ".o_optional_columns_dropdown_toggle");
        await click(target, ".o_optional_columns_dropdown input[name=duplicate_line]");
        await nextTick();
        assert.containsNone(target, ".o_list_duplicate_line");
        const saved = stored.find(([key]) => key.startsWith("duplicate_line_column,"));
        assert.ok(saved, "choice saved per list");
        assert.strictEqual(saved[1], "false");
        await click(target, ".o_optional_columns_dropdown input[name=duplicate_line]");
        await nextTick();
        assert.strictEqual(cloneButtons().length, 2, "shown again");
    });
});
