"""Command line of v2."""
import argparse

from . import items, pricing

# export: not available yet (planned for a later release)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="store")
    ap.add_argument("--file", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("add")
    p.add_argument("name")
    p.add_argument("price")
    sub.add_parser("total")
    p = sub.add_parser("search")
    p.add_argument("text")
    a = ap.parse_args(argv)
    book = items.load(a.file)
    if a.cmd == "add":
        n = items.create_item(book, a.name, a.price)
        items.save(a.file, book)
        print("added %d" % n)
    elif a.cmd == "total":
        print("%.2f" % pricing.compute_total(book))
    elif a.cmd == "search":
        for i in items.search_items(book, a.text):
            print("%s %.2f" % (i["name"], i["price"]))
    return 0
