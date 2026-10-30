"""S1 core: Budget tree behaviour (FakeBudget and SqliteBudget)."""

import threading
import unittest

from line import codes
from line.codes import LineError
from line.contracts import Budget
from line.tests.test_core_store import fake_env, sqlite_env


class BudgetContract:
    def make(self):
        raise NotImplementedError

    def setUp(self):
        self.e = self.make()
        self.b = self.e.budget
        self.b.open("R1", 10.0)
        self.b.split("R1", "R1", {"F1": 1, "F2": 1})                  # 5 / 5

    def split_units(self):
        from line.budget import size_weights
        self.b.split("R1", "F1", size_weights({"U1": "S", "U2": "M", "U3": "L"}))   # 1/2/4 of 5

    def test_is_budget(self):
        self.assertIsInstance(self.b, Budget)

    def test_size_weights_split(self):
        self.split_units()
        for node, lim in (("U1", 5 / 7), ("U2", 10 / 7), ("U3", 20 / 7)):
            self.assertAlmostEqual(self.b.state("R1", node).limit, lim)
        self.assertAlmostEqual(self.b.state("R1", "F2").limit, 5.0)

    def test_warn_at_80_percent(self):
        st = self.b.charge("R1", "F1", 3.9)
        self.assertFalse(st.warn)
        st = self.b.charge("R1", "F1", 0.1)             # 4.0 / 5.0 = 80%
        self.assertTrue(st.warn)
        self.assertFalse(self.b.state("R1", "R1").warn)  # root at 40%
        self.assertAlmostEqual(self.b.state("R1", "R1").spent, 4.0)

    def test_budget_exceeded_at_100_percent(self):
        r = self.b.reserve("R1", "F1", 4.0)
        self.assertAlmostEqual(self.b.remaining("R1", "F1"), 1.0)
        self.b.charge("R1", "F1", 4.0, r)
        self.assertAlmostEqual(self.b.state("R1", "F1").reserved, 0.0)
        self.b.reserve("R1", "F1", 1.0)                  # exactly 100% is allowed
        with self.assertRaises(LineError) as cm:
            self.b.reserve("R1", "F1", 0.01)
        self.assertEqual(cm.exception.code, codes.BUDGET_EXCEEDED)
        self.assertEqual(self.b.remaining("R1", "F1"), 0.0)

    def test_ancestor_limit_applies(self):
        self.split_units()
        self.b.charge("R1", "F2", 5.0)                   # F2 full: root at 5 / 10
        self.b.charge("R1", "U3", 2.0)                   # root 7 / 10, F1 2 / 5
        with self.assertRaises(LineError) as cm:
            self.b.reserve("R1", "U2", 1.43)             # 1.43 > U2 limit 10/7
        self.assertEqual(cm.exception.code, codes.BUDGET_EXCEEDED)
        self.b.charge("R1", "R1", 2.5)                   # root 9.5 / 10
        self.assertAlmostEqual(self.b.remaining("R1", "U1"), 0.5)
        with self.assertRaises(LineError) as cm:
            self.b.reserve("R1", "U1", 0.6)              # U1 has 0.71 left, root only 0.5
        self.assertEqual(cm.exception.code, codes.BUDGET_EXCEEDED)

    def test_release_and_charge_never_raises(self):
        r = self.b.reserve("R1", "F2", 2.0)
        self.b.release("R1", r)
        self.assertAlmostEqual(self.b.remaining("R1", "F2"), 5.0)
        st = self.b.charge("R1", "F2", 7.0)              # money spent: recorded, no raise
        self.assertAlmostEqual(st.spent, 7.0)
        self.assertEqual(st.remaining, 0.0)

    def test_unknown_node(self):
        with self.assertRaises(LineError) as cm:
            self.b.reserve("R1", "nope", 1)
        self.assertEqual(cm.exception.code, codes.NOT_FOUND)

    def test_concurrent_reserves_never_overspend(self):
        ok, refused = [], []
        barrier = threading.Barrier(8)

        def go():
            barrier.wait()
            for _ in range(10):
                try:
                    ok.append(self.b.reserve("R1", "F1", 0.1))
                except LineError as e:
                    refused.append(e.code)

        ts = [threading.Thread(target=go) for _ in range(8)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(len(ok), 50)                    # 5.0 / 0.1
        self.assertEqual(set(refused), {codes.BUDGET_EXCEEDED})


class FakeBudgetTest(BudgetContract, unittest.TestCase):
    def make(self):
        return fake_env()


class SqliteBudgetTest(BudgetContract, unittest.TestCase):
    def make(self):
        return sqlite_env(self)

    def test_budget_warn_event_once_per_node(self):
        s = self.e.store
        self.b.charge("R1", "F1", 3.0)
        self.assertEqual(s.events_after(0, kinds=[codes.BUDGET_WARN]), [])
        self.b.charge("R1", "F1", 1.0)                   # F1 hits 80%
        self.b.charge("R1", "F1", 0.5)                   # still above: no second warn
        evs = s.events_after(0, kinds=[codes.BUDGET_WARN])
        self.assertEqual([e.body["node"] for e in evs], ["F1"])
        self.assertAlmostEqual(evs[0].body["spent"], 4.0)
        self.assertEqual(evs[0].body["limit"], 5.0)
        self.assertEqual(evs[0].env.run, "R1")
        self.b.charge("R1", "F2", 3.5)                   # F2 70%, root 85% -> root warns
        self.assertEqual([e.body["node"] for e in s.events_after(0, kinds=[codes.BUDGET_WARN])], ["F1", "R1"])

    def test_split_units_helper_and_tree(self):
        self.b.split_units("R1", "F2", {"U9": "L"})
        self.assertAlmostEqual(self.b.state("R1", "U9").limit, 5.0)
        self.assertEqual([n["node"] for n in self.b.tree("R1")], ["R1", "F1", "F2", "U9"])
        with self.assertRaises(LineError):
            self.b.split_units("R1", "F2", {"U8": "XL"})

    def test_extend_grows_every_node_in_proportion(self):
        self.b.charge("R1", "F1", 5.0)                   # F1 used up
        self.b.extend("R1", 10.0)                        # a retried run (line.reopen): another 10
        self.assertAlmostEqual(self.b.state("R1", "R1").limit, 20.0)
        self.assertAlmostEqual(self.b.state("R1", "F1").limit, 10.0)
        self.assertAlmostEqual(self.b.remaining("R1", "F1"), 5.0)
        self.b.extend("R9", 3.0)                         # no tree yet: one is made
        self.assertAlmostEqual(self.b.state("R9", "R9").limit, 3.0)


if __name__ == "__main__":
    unittest.main()
