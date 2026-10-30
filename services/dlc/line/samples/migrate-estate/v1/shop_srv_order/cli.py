"""Order service: the shop's commands. Run: python cli.py --file PATH COMMAND [ARGS]."""
import argparse
import sys

from book import add_item, load, save

DISCOUNT_RATE = 0.10        # orders above 100 get 10 percent off
DISCOUNT_FROM = 100


def order_total(book):
    subtotal = sum(i["price"] for i in book["items"])
    if subtotal > DISCOUNT_FROM:
        subtotal = subtotal * (1 - DISCOUNT_RATE)
    return round(subtotal, 2)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="shop")
    ap.add_argument("--file", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("add")
    p.add_argument("name")
    p.add_argument("price")
    sub.add_parser("total")
    a = ap.parse_args(argv)
    book = load(a.file)
    if a.cmd == "add":
        n = add_item(book, a.name, a.price)
        save(a.file, book)
        print("added %d" % n)
    elif a.cmd == "total":
        print("%.2f" % order_total(book))
    return 0


if __name__ == "__main__":
    sys.exit(main())
