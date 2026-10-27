# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl.html)
from odoo.tests import HttpCase, tagged

from odoo.addons.web.tests.test_js import qunit_error_checker


@tagged("post_install", "-at_install")
class TestLineDuplicateJs(HttpCase):
    def test_qunit(self):
        self.browser_js(
            "/web/tests?filter=web_widget_one2many_tree_line_duplicate",
            "",
            "",
            login="admin",
            timeout=1800,
            error_checker=qunit_error_checker,
        )
