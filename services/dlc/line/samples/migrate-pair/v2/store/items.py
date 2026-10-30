"""Item storage of v2: a JSON file {"items": [{"name", "price"}]}."""
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


def create_item(book, name, price):
    book["items"].append({"name": name, "price": float(price)})
    return len(book["items"])


def search_items(book, text):
    """Items whose name contains text (case-insensitive), in stored order."""
    t = text.lower()
    return [i for i in book["items"] if t in i["name"].lower()]
