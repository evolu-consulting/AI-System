import unittest

from contracts import ContractError, create


class ContractsTest(unittest.TestCase):
    def test_sale(self):
        c = create("sale", {"buyer": "A", "seller": "B", "price_cents": 1000})
        self.assertEqual(c["kind"], "sale")

    def test_missing_field_names_it(self):
        with self.assertRaises(ContractError) as cm:
            create("lease", {"tenant": "A", "landlord": "B"})
        self.assertIn("rent_cents", str(cm.exception))
