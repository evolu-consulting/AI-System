"""CSV export of the order book (migrated from v1)."""


def export_csv(book):
    lines = ["name,price"]
    for i in book["items"]:
        lines.append("%s,%.2f" % (i["name"], i["price"]))
    return "\n".join(lines)
