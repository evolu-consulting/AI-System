"""Customer repository: CSV export of the order book (not part of the vanilla product)."""


def export_csv(book):
    """Customer custom feature: every item as one CSV line under a header."""
    lines = ["name,price"]
    for i in book["items"]:
        lines.append("%s,%.2f" % (i["name"], i["price"]))
    return "\n".join(lines)
