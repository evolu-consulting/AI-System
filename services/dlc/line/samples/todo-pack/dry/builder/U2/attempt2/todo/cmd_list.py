"""list: one line per task in id order."""

from todo import store


def run(path, args):
    data = store.load(path)
    for t in sorted(data["tasks"], key=lambda t: t["id"]):
        print(store.line(t))
    return 0
