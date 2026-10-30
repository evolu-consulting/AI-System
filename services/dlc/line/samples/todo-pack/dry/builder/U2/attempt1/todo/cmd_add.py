"""add TEXT: store a new open task and print its id."""

from todo import store


def run(path, args):
    data = store.load(path)
    t = store.new_task(data, " ".join(args))
    store.save(path, data)
    print("added %d" % t["id"])
    return 0
