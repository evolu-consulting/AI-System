"""Order book storage: the data layer of the order object (a JSON file)."""
import json
import os


def load(path):
    if not os.path.exists(path):
        return {"items": []}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save(path, book):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(book, fh)


def add_item(book, name, price):
    book["items"].append({"name": name, "price": float(price)})
    return len(book["items"])
