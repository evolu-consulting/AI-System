"""done ID: mark a task as done."""

import sys

from todo import store


def run(path, args):
    data = store.load(path)
    t = store.find(data, args[0] if args else "")
    if t is None:
        sys.stderr.write("error: no task %s\n" % (args[0] if args else ""))
        return 1
    t["done"] = True
    store.save(path, data)
    print("done %d" % t["id"])
    return 0
