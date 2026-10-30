"""add TEXT [--priority N]: store a new open task and print its id."""

import sys

from todo import store


def run(path, args):
    args = list(args)
    priority = store.DEFAULT_PRIORITY
    if "--priority" in args:
        i = args.index("--priority")
        value = args[i + 1] if i + 1 < len(args) else ""
        if value not in ("1", "2", "3"):
            sys.stderr.write("error: bad priority %s\n" % value)
            return 1
        priority = int(value)
        del args[i:i + 2]
    data = store.load(path)
    t = store.new_task(data, " ".join(args), priority)
    store.save(path, data)
    print("added %d" % t["id"])
    return 0
