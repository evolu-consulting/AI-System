import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import shop  # noqa: E402


class TestShop(unittest.TestCase):
    def test_add_item(self):
        book = {"items": []}
        self.assertEqual(shop.add_item(book, "pen", "2.5"), 1)

    def test_total_discount(self):
        book = {"items": [{"name": "a", "price": 80.0}, {"name": "b", "price": 40.0}]}
        self.assertEqual(shop.order_total(book), 108.0)

    def test_export_csv(self):
        book = {"items": [{"name": "pen", "price": 2.5}]}
        self.assertEqual(shop.export_csv(book), "name,price
pen,2.50")


if __name__ == "__main__":
    unittest.main()
