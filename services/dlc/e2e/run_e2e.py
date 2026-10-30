"""Drive the three SDLC scenarios against a running server, playing the human.

  python e2e/run_e2e.py s1 | s2 | s3 | all

s1 New System on the folder in SDLC_E2E_FOLDER (required), s2 New Feature on the same
project, s3 Bug Fix (a bug is injected first by inject_bug.py). Each scenario
waits for step 1 to ask, answers as the user, waits for the run to finish,
then runs the project's tests independently.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

BASE = os.environ.get("SDLC_URL", "http://127.0.0.1:8795")
FOLDER = os.environ.get("SDLC_E2E_FOLDER", "")   # required: a scratch folder the scenarios may overwrite
HERE = os.path.dirname(os.path.abspath(__file__))

S1 = ("Build a command-line todo app in Python 3.12, standard library only: a single file todo.py plus tests/test_todo.py "
      "(unittest). Data is stored in todos.json next to todo.py; the path can be overridden with the TODO_FILE environment "
      "variable so tests use a temp file. Commands: add <text>, list, done <id>, remove <id>. Ids are integers starting at 1 "
      "and never reused. list prints one line per item: '[x] 1 text' for done, '[ ] 2 text' for pending. Exit code 0 on "
      "success; an unknown id prints an error to stderr and exits 1. No GUI, no dependencies, no git commits. Tests must pass "
      "with 'python -m unittest discover -s tests -v' run from the project folder. That is everything; proceed.")
S2 = ("Add an optional priority: 'add <text> --priority high|medium|low' (default medium). list shows it after the id, e.g. "
      "'[ ] 2 (high) text', sorted high, medium, low then by id. Add 'list --status done|pending' and "
      "'list --priority high|medium|low'; the filters combine. Old items without a priority field load as medium. Extend the "
      "tests. No other behaviour changes. Proceed.")
S3 = ("Ticket BUG-1: 'python todo.py list --status done' prints the PENDING items and '--status pending' prints the DONE "
      "items. Repro: add a, add b, done 1, then 'list --status done' shows item 2 instead of item 1. Expected: --status done "
      "shows only completed items. Please add a regression test. No other docs; the existing tests are in tests/. Proceed.")


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def wait(rid, cond, limit, label):
    t0 = time.time()
    last = None
    while time.time() - t0 < limit:
        r = api("GET", "/api/runs/%d" % rid)["run"]
        state = (r["status"], r["currentPos"], tuple(s["status"] for s in r["steps"]))
        if state != last:
            log("run", rid, r["status"], "pos", r["currentPos"], [s["groupName"] + ":" + s["status"] for s in r["steps"]])
            last = state
        if cond(r):
            return r
        if r["status"] == "failed":
            raise SystemExit("run %d failed: %s" % (rid, [s.get("error") for s in r["steps"] if s.get("error")]))
        time.sleep(5)
    raise SystemExit("timeout waiting for " + label)


def drive(rid, answer):
    """Play the people of the combined PM + dev flow until the run is done.

    - a step waiting for an answer: the intake gets the scenario text first, any
      other gated step (UAT) gets an acceptance; a step that asks again gets
      'proceed', and after that the Continue button.
    - a step waiting for approval (scope sign-off, spec, UAT, a forced summary): Approve.
    """
    answered = {}
    t0 = time.time()
    last = None
    while time.time() - t0 < 7200:
        r = api("GET", "/api/runs/%d" % rid)["run"]
        state = (r["status"], r["currentPos"], tuple(s["status"] for s in r["steps"]))
        if state != last:
            log("run", rid, r["status"], "pos", r["currentPos"],
                [s["groupName"] + (" x%d" % s["attempt"] if s["attempt"] > 1 else "") + ":" + s["status"] for s in r["steps"]])
            last = state
        if r["status"] == "done":
            return r
        if r["status"] in ("failed", "cancelled", "paused"):
            raise SystemExit("run %d %s: %s" % (rid, r["status"], [s.get("error") for s in r["steps"] if s.get("error")]))
        cur = next(s for s in r["steps"] if s["position"] == r["currentPos"])
        pos = cur["position"]
        if cur["status"] == "awaiting_approval":
            api("POST", "/api/runs/%d/steps/%d/approve" % (rid, pos), {"note": "e2e: approved"})
            log("approved step", pos, cur["groupName"], "(forced)" if cur["forced"] else "")
        elif cur["status"] == "waiting_human":
            n = answered.get(pos, 0)
            msgs = api("GET", "/api/runs/%d/steps/%d/messages" % (rid, pos))["messages"]
            if msgs and msgs[-1]["senderKind"] == "human":
                time.sleep(5)  # our last answer has not been picked up yet
                continue
            log("agent asked:", " ".join((msgs[-1]["content"] if msgs else "")[:400].split()))
            if n == 0:
                text = answer if cur["role"] == "intake" else "I checked the evidence; everything meets the scope. I accept, close the step."
                api("POST", "/api/runs/%d/messages" % rid, {"content": text})
            elif n == 1:
                api("POST", "/api/runs/%d/messages" % rid, {"content": "Everything needed is above. Make reasonable assumptions and proceed now."})
            else:
                api("POST", "/api/runs/%d/steps/%d/proceed" % (rid, pos))
            answered[pos] = n + 1
            log("answered step", pos, cur["groupName"], "round", n + 1)
        time.sleep(5)
    raise SystemExit("timeout waiting for run %d" % rid)


def tests():
    p = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"], cwd=FOLDER,
                       capture_output=True, text=True)
    tail = (p.stderr or p.stdout).strip().splitlines()[-3:]
    log("independent test run exit", p.returncode, "|", " / ".join(tail))
    if p.returncode != 0:
        raise SystemExit("tests fail")


def todo(*args, env):
    p = subprocess.run([sys.executable, os.path.join(FOLDER, "todo.py"), *args], capture_output=True, text=True, env=env)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def s1():
    out = api("POST", "/api/projects", {"name": "TestProject", "folder": FOLDER, "workflowId": "wf-new-system",
                                        "title": "CLI todo app"})
    log("S1 project", out)
    drive(out["runId"], S1)
    tests()
    return out


def project_id():
    items = api("GET", "/api/projects?per=50")["items"]
    for p in items:
        if os.path.normcase(p["folder"]) == os.path.normcase(FOLDER):
            return p["id"]
    raise SystemExit("TestProject not found; run s1 first")


def s2():
    pid = project_id()
    out = api("POST", "/api/projects/%s/runs" % pid, {"workflowId": "wf-new-feature", "title": "Priority and list filters"})
    log("S2 run", out)
    drive(out["runId"], S2)
    tests()


def s3():
    pid = project_id()
    subprocess.run([sys.executable, os.path.join(HERE, "inject_bug.py")], check=True)
    out = api("POST", "/api/projects/%s/runs" % pid, {"workflowId": "wf-bug-fix", "title": "BUG-1 list --status filter inverted"})
    log("S3 run", out)
    drive(out["runId"], S3)
    tests()
    with tempfile.TemporaryDirectory() as d:
        env = dict(os.environ, TODO_FILE=os.path.join(d, "t.json"))
        todo("add", "a", env=env)
        todo("add", "b", env=env)
        todo("done", "1", env=env)
        code, out, err = todo("list", "--status", "done", env=env)
        log("repro after fix:", repr(out))
        if "1" not in out or " b" in out:
            raise SystemExit("bug still present")


if __name__ == "__main__":
    if not FOLDER:
        sys.exit("set SDLC_E2E_FOLDER to a scratch folder for the e2e test project")
    which =sys.argv[1] if len(sys.argv) > 1 else "all"
    t0 = time.time()
    for name in (["s1", "s2", "s3"] if which == "all" else [which]):
        log("=== scenario", name)
        globals()[name]()
        log("=== scenario", name, "PASSED after %.1f min" % ((time.time() - t0) / 60))
