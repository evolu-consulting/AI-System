"""S01 attach: namespace + manifest (event kinds with required fields, keyspace, record types, item kind with a
confirm policy, metric series, vault, subscription to a local receiver, redaction), measured attach-to-first-write.

Leftovers of an earlier run (sim1, sim1copy) are detached and purged first so every run starts clean.
"""
import base64
import json
import os
import subprocess
import time

from simlib import CONTAINER, PROJECT, ev_body, env_headers, standalone
import manifest as M

TITLE = "attach: namespace + manifest + receiver"
HERE = os.path.dirname(os.path.abspath(__file__))
RECV_OUT = "/tmp/sim_recv.jsonl"


_PING = ("import socket,sys\ns=socket.socket()\ns.settimeout(1)\n"
         f"sys.exit(0 if s.connect_ex(('127.0.0.1',{M.RECEIVER_PORT}))==0 else 1)")


def _listening() -> bool:
    return subprocess.run(["docker", "exec", CONTAINER, "python", "-c", _PING], capture_output=True).returncode == 0


def start_receiver():
    subprocess.run(["docker", "cp", os.path.join(HERE, "receiver.py"), f"{CONTAINER}:/tmp/sim_receiver.py"],
                   check=True, capture_output=True)
    stop_receiver()
    subprocess.run(["docker", "exec", "-d", CONTAINER, "python", "/tmp/sim_receiver.py", str(M.RECEIVER_PORT),
                    RECV_OUT], check=True, capture_output=True)
    for _ in range(30):
        if _listening():
            return True
        time.sleep(0.2)
    return False


def stop_receiver():
    """Ask a running receiver to quit and wait until the port is free (a new one must be able to bind)."""
    subprocess.run(["docker", "exec", CONTAINER, "python", "-c",
                    f"import urllib.request;urllib.request.urlopen('http://127.0.0.1:{M.RECEIVER_PORT}/quit',timeout=1)"],
                   capture_output=True)
    for _ in range(30):
        if not _listening():
            return
        time.sleep(0.2)


def received() -> list[dict]:
    r = subprocess.run(["docker", "exec", CONTAINER, "cat", RECV_OUT], capture_output=True, text=True)
    out = []
    for line in (r.stdout or "").splitlines():
        if line.strip():
            rec = json.loads(line)
            rec["body"] = base64.b64decode(rec.pop("body_b64"))
            out.append(rec)
    return out


def clean(sim, ns):
    p = sim.person
    r = p.get(f"/v1/admin/ns/{ns}", route="GET /admin/ns/{ns}")
    if r.status == 404:
        return "absent"
    st = r.j.get("state")
    if st == "purged":
        return "purged"
    if st in ("active", "suspended"):
        p.post(f"/v1/admin/ns/{ns}:detach", route="POST /admin/ns/{ns}:detach")
    r = p.post(f"/v1/admin/ns/{ns}:purge?force=true", route="POST /admin/ns/{ns}:purge")
    return f"purge {r.status}"


def run(sim, sc):
    for ns in (sim.ns, sim.ns + "copy"):
        sc.note(f"cleanup {ns}: {clean(sim, ns)}")
    sc.check("webhook receiver started inside the KH container on 127.0.0.1", start_receiver())
    recv_url = f"http://127.0.0.1:{M.RECEIVER_PORT}/hook"

    r = sim.person.get("/v1/capabilities", route="GET /v1/capabilities")
    caps = {c["name"]: c for c in r.j.get("capabilities", [])}
    need = ["registry", "coord", "events", "principals", "records", "rules", "redaction", "items", "retrieval", "vault",
            "packs", "metrics", "outbox", "lifecycle"]
    sc.check("discovery lists every capability the line needs, each at semver",
             r.status == 200 and all(n in caps and len(caps[n]["version"].split(".")) == 3 for n in need),
             [n for n in need if n not in caps])
    sc.numbers["capabilities"] = {n: caps[n]["version"] for n in need if n in caps}

    t0 = time.monotonic()
    r = sim.person.put(f"/v1/admin/ns/{sim.ns}", {"projects": [PROJECT], "display": "simulated delivery line"},
                       route="PUT /admin/ns/{ns}")
    sc.check("PUT /v1/admin/ns/sim1 -> 201 active with a locally provisioned client", r.status == 201
             and r.j.get("state") == "active" and (r.j.get("client") or {}).get("client_secret"), r)
    if r.status != 201:
        raise RuntimeError("attach failed")
    sim.set_client(r.j["client"])
    man = M.build(recv_url)
    sim.state["manifest"] = man
    r = sim.admin.put("/manifest", man, route="PUT /manifest")
    sc.check("manifest applies (rev 1) with the namespace client's admin token", r.status == 200
             and r.j.get("manifest_rev") == 1 and r.j.get("changed") is True, r)
    me = sim.admin.get("/v1/me", route="GET /v1/me")
    sc.check("the admin token is the namespace admin", me.j.get("role") == "admin" and me.j.get("ns") == sim.ns, me)
    a = sim.principal("agent-boot", "agent")
    r = a.post("/events", {"kind": "run.started", "project": PROJECT, "body": ev_body(step="boot")},
               headers=env_headers(run="run-boot", unit="u-boot", attempt=1), route="POST /events")
    first = time.monotonic() - t0
    sc.check(f"attach -> first accepted event in {first:.1f} s (< 60 s, G3)", r.status == 200 and first < 60, r)
    sc.numbers["attach_to_first_write_s"] = round(first, 2)

    r = sim.admin.put("/manifest", man, route="PUT /manifest")
    sc.check("applying the same manifest again changes nothing", r.status == 200 and r.j.get("changed") is False, r)
    g = sim.admin.get("/manifest", route="GET /manifest")
    doc = g.j.get("manifest") or {}
    types = {t["type"]: t for t in doc.get("types", [])}
    sc.check("GET manifest: 7 event kinds, 3 record types, item lesson, 2 metric series",
             all(k in types for k in M.EVENT_KINDS + ["decision-ledger", "guard-registry", "unit-state", "work-board", "lesson",
                                                      "first_pass_green", "lead_time"]), sorted(types))
    sc.check("GET manifest: required envelope run/unit/attempt on every line kind",
             all(set(types[k].get("required_envelope") or []) == set(M.REQUIRED_ENVELOPE) for k in M.EVENT_KINDS),
             {k: types.get(k, {}).get("required_envelope") for k in M.EVENT_KINDS})
    sc.check("GET manifest: keyspace role/step/stack, vault holdout, subscription, redaction kh-default",
             (doc.get("keyspaces") or [{}])[0].get("dims") == M.KEY_DIMS
             and [v["vault_id"] for v in doc.get("vaults", [])] == [M.VAULT]
             and [s["sub_id"] for s in doc.get("subscriptions", [])] == [M.SUB_ID]
             and "kh-default@1" in (doc.get("redaction") or {}).get("packs", []), doc.get("keyspaces"))
    sc.check("GET manifest: lesson confirm_policy roles [judge]; guard registry writable by admin only",
             (types.get("lesson", {}).get("confirm_policy") or {}).get("roles") == ["judge"]
             and types.get("guard-registry", {}).get("write_roles") == ["admin"], types.get("lesson"))
    r = sim.admin.get("/redaction", route="GET /redaction")
    sc.check("redaction for the namespace includes kh-default", r.status == 200 and "kh-default" in r.text, r)
    r = sim.admin.get("/subscriptions", route="GET /subscriptions")
    subs = {s["sub_id"]: s for s in r.j.get("subscriptions", [])}
    sc.check("the subscription is active and points at the receiver", M.SUB_ID in subs
             and subs[M.SUB_ID].get("url") == recv_url, r)


if __name__ == "__main__":
    standalone(run, "S01", TITLE)
