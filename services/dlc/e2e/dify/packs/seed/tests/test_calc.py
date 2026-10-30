import unittest
from calc import add


class T(unittest.TestCase):
    def test_add_zero(self):
        self.assertEqual(add(0, 0), 0)
