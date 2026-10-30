"""Drive one DLC run per process through the engine with the Dify process layer; answer person forms like a user.

    python drive.py --engine http://127.0.0.1:8797 --sdlc <Slaves/SDLC> --work <dir> [--flow new-system ...]
Prints a timeline per run and writes results.json next to this file.
"""
import argparse
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
#: how the "person" answers each form, by form title
ANSWERS = {"Approve the scope": ("approve", {"comment": "ok, build it"}),
           "Pick the level": ("go", {"level": "2"}),
           "Run failed: triage": ("close", {"note": "test: close"})}
TERMINAL = ("green", "escalated", "cancelled")


def http(method, url, body=None, timeout=60):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode("utf-8", "replace")[:800]}
    except (urllib.error.URLError, OSError) as e:
        return 0, {"error": str(e)}


def drive(engine, sdlc, work, flow, pack_src, max_s):
    sys.path.insert(0, sdlc)
    from line.pipeline import init_target
    root = os.path.join(work, flow)
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root)
    pack = os.path.join(root, "pack")
    own = os.path.join(pack_src, flow)                 # --pack is a folder of packs per flow (plus seed/), or one pack
    shutil.copytree(own if os.path.isdir(own) else pack_src, pack)
    target = init_target(os.path.join(root, "target"))
    seed = os.path.join(pack_src, "seed")
    if flow != "new-system" and os.path.isdir(seed):   # an existing project for enhancement / bug fix
        import subprocess
        shutil.copytree(seed, target, dirs_exist_ok=True)
        subprocess.run(["git", "-C", target, "add", "-A"], check=True)
        subprocess.run(["git", "-C", target, "-c", "user.name=seed", "-c", "user.email=seed@local", "commit", "-qm",
                        "seed"], check=True)
    t0 = time.time()
    st, res = http("POST", engine + "/api/runs", {"pack": pack, "target": target, "flow": flow, "name": "dify " + flow})
    out = {"flow": flow, "start": [st, res], "timeline": [], "answers": []}
    run = res.get("run")
    if not run:
        return out
    out["run"] = run
    seen = set()
    last = None
    while time.time() - t0 < max_s:
        _, row = http("GET", engine + "/api/runs/" + run)
        _, pv = http("GET", engine + "/api/runs/%s/process" % run)
        proc = (pv or {}).get("process") or {}
        state = (row or {}).get("state") if not isinstance((row or {}).get("run"), dict) else row["run"].get("state")
        snap = (state, proc.get("status"), tuple(sorted((proc.get("pending") or {}).keys())), proc.get("answered"))
        if snap != last:
            out["timeline"].append({"s": round(time.time() - t0), "state": state, "proc": proc.get("status"),
                                    "pending": [f.get("title") for f in (proc.get("pending") or {}).values()],
                                    "answered": proc.get("answered"),
                                    "groups": [(g.get("group"), g.get("ok")) for g in proc.get("groups") or []]})
            print(flow, out["timeline"][-1], flush=True)
            last = snap
        for fid, f in (proc.get("pending") or {}).items():
            if fid in seen:
                continue
            action, inputs = ANSWERS.get(f.get("title"), (None, None))
            if action is None:
                out["answers"].append({"form": f.get("title"), "error": "no scripted answer"})
                seen.add(fid)
                continue
            st, res = http("POST", engine + "/api/runs/%s/process/forms/%s" % (run, fid),
                           {"action": action, "inputs": inputs, "who": "drive.py"})
            out["answers"].append({"form": f.get("title"), "action": action, "status": st, "res": res})
            print(flow, "answered", f.get("title"), action, st, flush=True)
            seen.add(fid)
        done_proc = proc.get("status") not in (None, "paused", "running") or (proc.get("outcome") or {})
        if state in TERMINAL and (done_proc or not proc):
            break
        time.sleep(3)
    _, row = http("GET", engine + "/api/runs/" + run)
    row = row.get("run") if isinstance(row.get("run"), dict) else row
    _, pv = http("GET", engine + "/api/runs/%s/process" % run)
    out["final"] = {"row_state": row.get("state"), "escalation": (row.get("detail") or {}).get("escalation"),
                    "sizing": (row.get("detail") or {}).get("sizing"), "process": (pv or {}).get("process")}
    out["seconds"] = round(time.time() - t0)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default="http://127.0.0.1:8797")
    ap.add_argument("--sdlc", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--pack", default="")
    ap.add_argument("--flow", action="append")
    ap.add_argument("--max-s", type=int, default=900)
    ap.add_argument("--out", default=os.path.join(HERE, "results.json"))
    a = ap.parse_args()
    pack = a.pack or os.path.join(a.sdlc, "line", "samples", "todo-pack")
    results = []
    for flow in a.flow or ["new-system", "enhancement", "bug-fix", "feature-migration"]:
        results.append(drive(a.engine, a.sdlc, a.work, flow, pack, a.max_s))
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump(results, fh, indent=1, default=str)


if __name__ == "__main__":
    main()
