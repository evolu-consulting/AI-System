import os
import subprocess
import sys
import tempfile
import unittest

from store import items, pricing

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def cli(path, *args):
    p = subprocess.run([sys.executable, "-m", "store", "--file", path] + list(args), cwd=ROOT,
                       capture_output=True, text=True, timeout=60)
    return p.returncode, p.stdout


class TestStore(unittest.TestCase):
    def setUp(self):
        self.path = os.path.join(tempfile.mkdtemp(prefix="store-"), "book.json")

    def test_create_item(self):
        self.assertEqual(cli(self.path, "add", "pen", "2.5"), (0, "added 1\n"))

    def test_total_discount(self):
        book = {"items": [{"name": "a", "price": 80.0}, {"name": "b", "price": 40.0}]}
        self.assertEqual(pricing.compute_total(book), 114.0)

    def test_search(self):
        book = {"items": [{"name": "Red pen", "price": 2.0}, {"name": "cup", "price": 3.0}]}
        self.assertEqual([i["name"] for i in items.search_items(book, "PEN")], ["Red pen"])


if __name__ == "__main__":
    unittest.main()
