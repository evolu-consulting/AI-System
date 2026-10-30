"""Storage contract: one JSON object {"tasks": [task, ...]} in the file given by --file.

task = {"id": int, "text": str, "done": bool, "priority": int}. Ids start at 1 and are never
reused ("last_id" remembers the highest id ever stored).
"""

import json
import os

DEFAULT_PRIORITY = 2


def load(path):
    if not os.path.exists(path):
        return {"tasks": []}
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    data.setdefault("tasks", [])
    return data


def save(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1)
    os.replace(tmp, path)


def next_id(data):
    ids = [int(t["id"]) for t in data["tasks"]]
    return max(ids + [int(data.get("last_id", 0))]) + 1


def find(data, task_id):
    for t in data["tasks"]:
        if str(t["id"]) == str(task_id):
            return t
    return None


def new_task(data, text, priority=DEFAULT_PRIORITY):
    t = {"id": next_id(data), "text": text, "done": False, "priority": int(priority)}
    data["tasks"].append(t)
    data["last_id"] = t["id"]
    return t


def line(t):
    return "%d [%s] %s" % (t["id"], "x" if t.get("done") else " ", t["text"])
