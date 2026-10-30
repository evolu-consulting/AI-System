"""S10 plug-out: detach -> every /v1/sim1/* route 404 within 5 s and an in-flight fenced writer never lands a write
after the detach; export zip with checksums; re-attach -> the old epoch fails, a new lease works; import the export
into a new namespace 'sim1copy' and compare row counts and sha256 per table (re-export of the copy).
"""
import hashlib
import io
import json
import threading
import time
import zipfile

from simlib import PROJECT, Client, env_headers, ev_body, standalone, uid

TITLE = "plug-out: detach 404 <= 5 s, fenced writer fails, export, reattach epochs, import copy"


def _zip_check(content: bytes):
    z = zipfile.ZipFile(io.BytesIO(content))
    sums = json.loads(z.read("checksums.json"))["files"]
    bad = [n for n, s in sums.items() if hashlib.sha256(z.read(n)).hexdigest() != s["sha256"]]
    return z, sums, bad


def run(sim, sc):
    ns, copy = sim.ns, sim.ns + "copy"
    agent = sim.principal("agent-plug", "agent")
    tag = uid("p").split("-")[1][:6]
    lease = f"unit/plug-{tag}"
    r = agent.post(f"/leases/{lease}:acquire", {"ttl_s": 60}, route="POST /leases/{name}:acquire")
    old_epoch = r.j.get("epoch")
    FH = env_headers(run=f"run-{tag}", unit=f"plug-{tag}", attempt=1, lease=lease, epoch=old_epoch)
    r = agent.put(f"/records/unit-state/plug-{tag}", {"unit": f"plug-{tag}", "status": "claimed", "n": 0},
                  headers={**FH, "If-None-Match": "*"}, route="PUT /records/unit-state (fenced)")
    sc.check("before detach: lease held and a fenced write lands", r.status == 201 and old_epoch, r)

    # an in-flight fenced writer keeps writing across the detach
    log, stop = [], threading.Event()

    def writer():
        n = 0
        while not stop.is_set():
            n += 1
            t = time.monotonic()
            rr = agent.put(f"/records/unit-state/plug-{tag}", {"unit": f"plug-{tag}", "status": "working", "n": n},
                           headers=FH, route="PUT /records/unit-state (in-flight)")
            log.append((t, time.monotonic(), rr.status, rr.error))
            time.sleep(0.05)

    th = threading.Thread(target=writer, daemon=True)
    th.start()
    time.sleep(1.0)
    probes = [("GET", "/manifest"), ("GET", "/leases"), ("GET", f"/records/unit-state/plug-{tag}"),
              ("POST", "/events"), ("POST", "/context/step"), ("GET", "/events")]
    t_detach = time.monotonic()
    r = sim.person.post(f"/v1/admin/ns/{ns}:detach", route="POST /admin/ns/{ns}:detach")
    t_done = time.monotonic()
    sc.check("detach is 200 (state detached)", r.status == 200 and r.j.get("state") == "detached", r)

    def all_404():
        for m, p in probes:
            body = {"kind": "run.started", "project": PROJECT, "body": ev_body()} if p == "/events" and m == "POST" \
                else ({"project": PROJECT, "keyspace": "step", "key": {}} if m == "POST" else None)
            rr = sim.admin.call(m, p, body, route=f"{m} {p} (detached)")
            if rr.status != 404 or rr.error != "ns_not_active":
                return False
        return True

    ok, took = sim.wait(all_404, timeout=8, every=0.1)
    sc.check(f"every probed /v1/{ns}/* route answers 404 ns_not_active within 5 s ({took:.2f} s)", ok and took <= 5,
             took)
    sc.numbers["detach_404_s"] = round(took, 2)
    time.sleep(1.5)
    stop.set()
    th.join(5)
    before = [x for x in log if x[1] < t_detach]
    after = [x for x in log if x[0] >= t_detach]
    landed_after = [x for x in log if x[0] >= t_done and 200 <= x[2] < 300]
    sc.numbers["inflight_writer"] = {"before_ok": sum(1 for x in before if x[2] == 200), "after": len(after),
                                     "after_codes": sorted({f"{x[2]} {x[3]}" for x in after})}
    sc.check("the in-flight fenced writer landed writes before the detach", any(x[2] == 200 for x in before))
    sc.check("... and NONE after it: every later write is 404 ns_not_active or 409 stale_epoch",
             after and not landed_after and all(x[2] in (404, 409) for x in after if x[0] >= t_done),
             sorted({(x[2], x[3]) for x in after}))

    # export while detached
    r = sim.person.get(f"/v1/admin/ns/{ns}:export", route="GET /admin/ns/{ns}:export", timeout=300)
    sc.check("export while detached: 200 application/zip with export id", r.status == 200
             and r.headers.get("Content-Type", "").startswith("application/zip") and r.headers.get("X-KH-Export-Id"), r)
    z, sums, bad = _zip_check(r.content)
    names = set(z.namelist())
    sc.check("checksums.json covers every file and every sha256 matches", not bad
             and names - {"checksums.json"} == set(sums), bad[:5])
    sc.check("the export has no vault tables without include_vault", not any("vault" in n for n in names),
             sorted(n for n in names if "vault" in n))
    rows = {n: s.get("rows") for n, s in sums.items() if n.startswith("tables/")}
    sc.numbers["export"] = {"bytes": len(r.content), "files": len(sums), "kh_event_rows": rows.get("tables/kh_event.ndjson"),
                            "kh_record_rows": rows.get("tables/kh_record.ndjson"),
                            "kh_rule_rows": rows.get("tables/kh_rule.ndjson"), "kh_item_rows": rows.get("tables/kh_item.ndjson")}
    export = r.content

    # re-attach: old epochs fail, new leases work
    r = sim.person.post(f"/v1/admin/ns/{ns}:reattach", route="POST /admin/ns/{ns}:reattach")
    sc.check("re-attach within grace -> active", r.status == 200 and r.j.get("state") == "active", r)
    r = sim.admin.get("/manifest", route="GET /manifest")
    sc.check("the namespace serves again (admin client re-enabled)", r.status == 200, r)
    r = agent.get("/leases", route="GET /leases")
    sc.check("old principals stay suspended after re-attach (401)", r.status == 401, r)
    agent2 = sim.principal(f"agent-plug2-{tag}", "agent")
    r = agent2.put(f"/records/unit-state/plug-{tag}", {"unit": f"plug-{tag}", "status": "zombie"}, headers=FH,
                   route="PUT /records/unit-state (fenced)")
    sc.check("a write with the pre-detach epoch is 409 stale_epoch", r.status == 409 and r.error == "stale_epoch", r)
    r = agent2.post(f"/leases/{lease}:acquire", {"ttl_s": 30}, route="POST /leases/{name}:acquire")
    new_epoch = r.j.get("epoch")
    sc.check(f"a new lease is granted above the detach epoch ({old_epoch} -> {new_epoch})", r.status == 200
             and new_epoch and new_epoch > old_epoch + 1, r)
    r = agent2.put(f"/records/unit-state/plug-{tag}", {"unit": f"plug-{tag}", "status": "resumed"},
                   headers=env_headers(run=f"run-{tag}", unit=f"plug-{tag}", attempt=2, lease=lease, epoch=new_epoch),
                   route="PUT /records/unit-state (fenced)")
    sc.check("the new holder's fenced write lands", r.status == 200, r)

    # import into a new namespace id and compare
    r = sim.person.call("POST", f"/v1/admin/ns:import?ns={copy}&rebuild=sync", data=export,
                        headers={"Content-Type": "application/zip"}, route="POST /admin/ns:import", timeout=600)
    rep = r.j
    sc.check(f"import into '{copy}': 201, arrives detached, every file's rows and sha256 match", r.status == 201
             and rep.get("ns") == copy and rep.get("state") == "detached" and rep.get("match") is True, r)
    mism = {p: f for p, f in (rep.get("files") or {}).items() if not f.get("match")}
    sc.check("import report: no file mismatched", not mism, mism)
    r = sim.person.get(f"/v1/admin/ns/{copy}:export", route="GET /admin/ns/{ns}:export", timeout=300)
    z2, sums2, bad2 = _zip_check(r.content)
    diff = sorted(p for p in sums if p != "manifest.json" and (p not in sums2 or sums2[p]["sha256"] != sums[p]["sha256"]
                                                                  or sums2[p].get("rows") != sums[p].get("rows")))
    sc.check(f"re-export of '{copy}': identical row counts and sha256 for every table ({len(sums) - 1} files)",
             r.status == 200 and not bad2 and not diff, diff[:8])
    sc.numbers["import_compare"] = {"files": len(sums) - 1, "different": len(diff),
                                    "rows_total": sum(v or 0 for v in rows.values())}
    r = sim.person.post(f"/v1/admin/ns/{copy}:reattach", route="POST /admin/ns/{ns}:reattach")
    sc.check(f"'{copy}' re-attaches", r.status == 200 and r.j.get("state") == "active", r)
    r = sim.person.post(f"/v1/admin/ns/{copy}:client", route="POST /admin/ns/{ns}:client")
    cadmin = None
    if r.status in (200, 201) and (r.j.get("client_secret") or (r.j.get("client") or {}).get("client_secret")):
        cl = r.j.get("client") or r.j
        csim = type(sim)(sim.base, sim._dev, ns=copy)
        csim.set_client(cl)
        csim.stats = sim.stats
        cadmin = csim.admin
    sc.check(f"a namespace client for '{copy}'", cadmin is not None, r)
    if cadmin:
        a = sim.admin.get(f"/records/unit-state/plug-{tag}", route="GET /records/unit-state")
        b = cadmin.get(f"/records/unit-state/plug-{tag}", route="GET /records/unit-state")
        sc.check(f"'{copy}' serves the record as it was at export time (rev 2, status working)",
                 b.status == 200 and b.j.get("body", {}).get("n", -1) >= 1 and a.j.get("rev", 0) > b.j.get("rev", 0), b)
    r = sim.person.post(f"/v1/admin/ns/{copy}:detach", route="POST /admin/ns/{ns}:detach")
    sc.check(f"'{copy}' detached again (the copy stays parked)", r.status == 200, r)


if __name__ == "__main__":
    standalone(run, "S10", TITLE)
