"""Feature migration: per-stack extractors and the comparison method rules, on a tiny synthetic CAP/CDS + UI5
pair shaped like a real multi-repo v1 -> monorepo v2 rewrite (all names synthetic)."""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from types import SimpleNamespace

from line.migrate import blast, conflicts, effort, extract, specgen
from line.migrate.match import _rule_check, match
from line.migrate.matrix import rows as matrix_rows
from line.migrate.tree import Tree

V1 = {
    # one folder per old repo: <product>_<layer>_<name>
    "acme_srv_config_admin/srv/admin-service.cds": "service AdminService { entity Settings as projection on db.Settings; }\n",
    "acme_srv_integration/srv/integration.cds": "service IntegrationProcessService { action send(); }\n",
    "acme_db_purchasing/db/schema.cds": "namespace acme;\nentity PurchasingSource { key ID: UUID; }\nentity SourceList { key ID: UUID; }\n",
    "acme_app_orders/webapp/view/Detail.view.xml": '<mvc:View controllerName="acme.orders.controller.Detail"/>\n',
    "acme_app_orders/webapp/view/Legacy.view.xml": "<mvc:View/>\n",
    "acme_srv_orders/srv/orders.js": "module.exports = srv => { srv.on('approve', 'Orders', approveHandler) }\nfunction approveHandler(req) {}\n",
}
V2 = {
    "srv-config-admin/srv/admin-service.cds": "service AdminService { entity Settings as projection on db.Settings; }\n",
    "srv-integration/srv/integration.cds": "service IntegrationService { action send(); }\n",
    "db-core/db/schema.cds": "namespace acme;\nentity BusinessPartner { key ID: UUID; }\n",
    "app/webapp/view/npiProject/Detail.view.xml": '<mvc:View controllerName="acme.app.controller.Detail"/>\n',
    "srv-orders/srv/orders.ts": ("export default class OrdersService { init() { this.before('approve', 'Orders', this.esign) } }\n"
                                 "const cfg = { destination: 'ScoutCalculationService' }\n"),
    "generator/object-type.json": '{"types": ["PurchasingSource", "BusinessPartner"]}\n',
    "test/integration/fixtures/mock.cds": "service FixtureOnlyService {}\n",
}


def _tree(root, files):
    for rel, text in files.items():
        p = os.path.join(root, *rel.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(text)
    return Tree(root)


class ExtractorRules(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="mig-rules-")
        self.t1 = _tree(os.path.join(self.dir, "v1"), V1)
        self.t2 = _tree(os.path.join(self.dir, "v2"), V2)
        self.f1, self.f2 = extract.extract(self.t1), extract.extract(self.t2)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_names_and_detection(self):
        self.assertEqual(self.f1["stacks"], ["generic", "cap-cds-ui5"])
        self.assertEqual(extract.module_key("acme_srv_config_admin"), "srv-config-admin")
        self.assertEqual(extract.module_key("srv-config-admin"), "srv-config-admin")
        self.assertEqual(extract.screen_key("app/webapp/view/npiProject/Detail.view.xml"), "detail")
        self.assertEqual(extract.rename_key("IntegrationProcessService"), extract.rename_key("IntegrationService"))
        self.assertNotEqual(extract.rename_key("OrderService"), extract.rename_key("OrderItemService"))

    def test_facts(self):
        self.assertIn("srv-config-admin", self.f1["modules"])
        self.assertIn("srv-config-admin", self.f2["modules"])
        self.assertEqual(set(self.f1["entities"]), {"PurchasingSource", "SourceList", "Settings"})
        self.assertNotIn("FixtureOnlyService", self.f2["services"])            # fixtures are not features
        self.assertIn("test/integration/fixtures/mock.cds", self.f2["fixtures"])
        self.assertIn("PurchasingSource", self.f2["catalogue"])                 # named only in a generator catalogue
        self.assertNotIn("BusinessPartner", self.f2["catalogue"])                # declared in .cds: built
        self.assertIn("ScoutCalculationService", self.f2["strings"])
        self.assertIn("before approve Orders", self.f2["handlers"])
        self.assertIn("on approve Orders", self.f1["handlers"])

    def test_surface_compare(self):
        c = extract.compare(self.f1, self.f2)
        self.assertIn("srv-config-admin", c["modules"]["both"])
        self.assertEqual(c["screens"]["both"], ["detail"])                       # basename, not path
        self.assertEqual(c["screens"]["v1_only"], ["legacy"])
        self.assertEqual(c["services"]["renamed"], [("IntegrationProcessService", "IntegrationService")])
        self.assertEqual(c["entities"]["v1_only"], ["PurchasingSource", "SourceList"])
        self.assertIn("planned, not built", c["entities"]["notes"]["PurchasingSource"])
        self.assertNotIn("SourceList", c["entities"]["notes"])

    def test_confirmation_rules(self):
        others = [{"id": "v2.integration", "identifiers": ["IntegrationService"]}]
        r = _rule_check({"identifiers": ["IntegrationProcessService"]}, others, self.f2)
        self.assertEqual((r["verdict"], r["partner"]), ("present", "v2.integration"))
        r = _rule_check({"identifiers": ["PurchasingSource"]}, [], self.f2)
        self.assertEqual((r["verdict"], r["note"]), ("absent", "planned-not-built"))
        r = _rule_check({"identifiers": ["ScoutCalculationService"]}, [], self.f2)
        self.assertEqual((r["verdict"], r["note"]), ("absent", "string-only"))
        self.assertEqual(_rule_check({"identifiers": ["BusinessPartner"]}, [], self.f2), {})   # declared: model decides
        # a config file is never proof that a feature is built
        self.assertEqual(self.t2.find(["PurchasingSource"]), {})


class Llm:
    def __init__(self, answers):
        self.answers = answers

    def complete(self, role, prompt, schema=None, *, key="", model=None, run=""):
        return SimpleNamespace(data=self.answers.get((role, key), self.answers.get(role)))


def F(fid, side, name, kind="other", ents=(), ifs=(), ids=(), area="Orders", tests=(), path="x.py"):
    return {"id": "%s.%s" % (side, fid), "side": side, "name": name, "kind": kind, "area": area,
            "behaviour": name + " behaviour.", "evidence": [{"path": path, "quote": "q", "verified": True}],
            "identifiers": list(ids), "entities": list(ents), "interfaces": list(ifs), "tests": list(tests),
            "examples": []}


class BehaviourAndBlast(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="mig-blast-")
        self.t2 = _tree(os.path.join(self.dir, "v2"), {"srv/a.py": "x = 1\n"})

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_decisions_gates_merges_effort(self):
        v1 = [F("pir", "v1", "Purchasing info record", "data", ["InfoRecord", "BusinessPartner"], ["approve"],
                area="Purchasing"),
              F("flow", "v1", "Approve flow", "command", ["Order"], ["approve"], area="Orders")]
        v2 = [F("esign", "v2", "E-signature gate on approve", "guard", ["Order"], ["approve"], tests=["tests/test_esign.py"]),
              F("bp", "v2", "Business partner", "data", ["BusinessPartner"], ["bp"], area="Partners")]
        llm = Llm({"migrate_match": {"pairs": [], "decisions": [
            {"question": "Which target API for Purchasing info record (no v1 binding)?",
             "options": [{"id": "api-a", "label": "API A"}, {"id": "api-b", "label": "API B"}], "recommended": "api-b"},
            {"question": "bad: one option", "options": [{"id": "x"}]}]},
                   "migrate_confirm": {"verdict": "absent"}})
        t1 = _tree(os.path.join(self.dir, "v1"), {"a.py": "y = 1\n"})
        m = match({"features": v1}, {"features": v2}, t1, self.t2, llm)
        self.assertEqual(len(m["decisions"]), 1)
        recs = conflicts.decision_records(m["decisions"], 1)
        self.assertEqual(conflicts.choices(recs[0]), ["api-a", "api-b"])
        self.assertEqual(conflicts.default_choice(recs[0]), "api-b")
        self.assertEqual(conflicts.question(recs[0])["kind"], "decision")
        rows = matrix_rows({"features": v1}, {"features": v2}, m)
        by = {f["id"]: f for f in v1 + v2}
        b = blast.radius(rows, recs, by, self.t2)
        self.assertEqual([(g["feature"], sorted(g["applies_to"])) for g in b["gates"]],
                         [("v2.esign", ["v1.flow", "v1.pir"])])
        self.assertEqual(b["merges"], [{"feature": "v1.pir", "entities": ["BusinessPartner"]}])
        lv = {c["feature"]: c["level"] for c in b["changes"]}
        self.assertEqual(lv["v1.pir"], "high")
        pk = specgen.pack(os.path.join(self.dir, "pk"), "T", b["changes"], by, recs, b["gates"])
        self.assertEqual(pk["spec"].count("must pass through the existing rule 'E-signature gate on approve'"), 2)
        e = effort.hints(rows, by, b)
        areas = {a["area"]: a for a in e["areas"]}
        self.assertEqual((areas["Purchasing"]["port"], areas["Purchasing"]["entities"], areas["Purchasing"]["high_blast"]),
                         (1, 2, 1))
        self.assertEqual(areas["Orders"]["tests"], 1)


if __name__ == "__main__":
    unittest.main()
