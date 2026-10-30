"""list [--priority]: one line per task, in id order or by priority (stable: ties keep id order)."""

from todo import store


def _key(t):
    return (int(t.get("priority", store.DEFAULT_PRIORITY)), int(t["id"]))


def run(path, args):
    data = store.load(path)
    if "--priority" in args:
        tasks = sorted(data["tasks"], key=_key)
    else:
        tasks = sorted(data["tasks"], key=lambda t: int(t["id"]))
    for t in tasks:
        print(store.line(t))
    return 0
