"""list [--priority]: one line per task, in id order or by priority."""

from todo import store


def run(path, args):
    data = store.load(path)
    tasks = sorted(data["tasks"], key=lambda t: t["id"])
    if "--priority" in args:
        tasks.sort(key=lambda t: int(t.get("priority", store.DEFAULT_PRIORITY)))
    for t in tasks:
        print(store.line(t))
    return 0
