"""Two standalone dark HTML pages per project.

- Feature Report: every feature and bug fix, its steps (PM and dev lanes), their
  status, timings, verdicts, the server's test runs, the summary each step
  pushed, the scope trace and the run's register items.
- Status Report: the PM's one-page weekly (or any period) status, drafted from
  the data: health with reasons, done this period, in flight, next, top risks,
  decisions waiting, open escalations, spend against budget. audience=client
  leaves out cost, agents and internal items.
"""

import html
import json
from datetime import datetime

import db
import gov

ICON = {"done": "&#10003;", "running": "&#8635;", "waiting_human": "&#9993;", "awaiting_approval": "&#9873;",
        "pending": "&#8987;", "failed": "&#10007;", "rework": "&#8630;", "skipped": "&#8212;", "paused": "&#10074;&#10074;",
        "cancelled": "&#8856;"}
COLOR = {"done": "#4ade80", "running": "#60a5fa", "waiting_human": "#fbbf24", "awaiting_approval": "#c084fc",
         "pending": "#a3a3a3", "failed": "#f87171", "rework": "#fb923c", "skipped": "#737373", "paused": "#fbbf24",
         "cancelled": "#737373"}
RAG = {"green": "#4ade80", "amber": "#fbbf24", "red": "#f87171"}

CSS = """
:root{--bg:#2b2b2b;--card:#1f1f1f;--fg:#f7f7f7;--mut:#b5b5b5;--bd:rgba(255,255,255,.08)}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 'Segoe UI',system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}.sub{color:var(--mut);font-size:13px}
.bar{height:10px;border-radius:6px;background:rgba(255,255,255,.08);margin:14px 0 24px;overflow:hidden}.bar i{display:block;height:100%;background:#4ade80}
.counts{display:flex;gap:28px;font-weight:600;margin-top:12px;flex-wrap:wrap}
.run,.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:14px 16px;margin:0 0 14px}
.rh{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.pill{border:1px solid var(--bd);border-radius:999px;padding:2px 10px;font-size:12px;background:rgba(255,255,255,.05)}
.pill.bug{background:rgba(249,115,22,.2);color:#fdba74;border-color:rgba(249,115,22,.4)}
.lane{font-size:10px;border-radius:4px;padding:0 5px;text-transform:uppercase;letter-spacing:.05em}
.lane.pm{background:rgba(168,85,247,.25);color:#e9d5ff}.lane.dev{background:rgba(56,189,248,.2);color:#bae6fd}
.rag{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
.st{font-size:12px;font-weight:600}.du{color:var(--mut);font-size:12px}
.step{border-top:1px solid var(--bd);padding:10px 0 4px 8px}.sh{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.step p{margin:6px 0;color:#e5e5e5;font-size:13px}.k{color:var(--mut)!important;font-size:11px!important;text-transform:uppercase;letter-spacing:.05em}
ul{margin:4px 0 6px 18px;padding:0;font-size:13px}code{font-size:12px;background:rgba(255,255,255,.06);padding:1px 4px;border-radius:4px;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:13px;margin:4px 0 8px}td,th{border-top:1px solid var(--bd);padding:5px 6px;text-align:left;vertical-align:top}
th{color:var(--mut);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.err{color:#fca5a5!important}.ok{color:#86efac}.bad{color:#fca5a5}
.tok{margin-left:auto;font-size:12px;color:#e5e5e5;font-variant-numeric:tabular-nums;cursor:help}
pre{white-space:pre-wrap;font-size:12px;background:rgba(0,0,0,.25);padding:8px;border-radius:6px;max-height:220px;overflow:auto}
@media print{body{background:#fff;color:#111}.run,.card{background:#fff;border-color:#ddd}.sub,.du,th{color:#555}}
"""


def _dur(a, b):
    try:
        t0 = datetime.strptime(a, "%Y-%m-%dT%H:%M:%SZ")
        t1 = datetime.strptime(b, "%Y-%m-%dT%H:%M:%SZ")
        s = int((t1 - t0).total_seconds())
        return "%dm %02ds" % (s // 60, s % 60)
    except (TypeError, ValueError):
        return "-"


def _count(n):
    """Same short form as the page (web/src/lib/usage.ts): 950, 4.5k, 458k, 1.2m."""
    for div, suffix in ((1000000, "m"), (1000, "k")):
        if n >= div:
            v = n / div
            return ("%.1f" % v if v < 10 else "%d" % round(v)) + suffix
    return str(n)


def _spent(u):
    """'458k tokens &middot; $0.39' with the breakdown on hover; '' when nothing was recorded."""
    if not u or not u["calls"]:
        return ""
    money = "&lt;$0.01" if 0 < u["costUsd"] < 0.01 else "$%.2f" % u["costUsd"]
    tip = "input %s, output %s, cache write %s, cache read %s, %d agent calls, $%.4f at list price" % (
        "{:,}".format(u["input"]), "{:,}".format(u["output"]), "{:,}".format(u["cacheWrite"]),
        "{:,}".format(u["cacheRead"]), u["calls"], u["costUsd"])
    return '<span class="tok" title="%s">%s tokens &middot; %s</span>' % (tip, _count(u["tokens"]), money)


def _step_usage(run_ids):
    if not run_ids:
        return {}
    rows = db.q("SELECT c.step_run_id AS sid, %s FROM llm_call c WHERE c.run_id IN (%s) GROUP BY c.step_run_id" % (
        db.USAGE_SUM, ",".join("?" * len(run_ids))), *run_ids)
    return {r["sid"]: db._usage(r) for r in rows}


def e(x):
    return html.escape(str(x if x is not None else ""))


def _rag(h):
    return '<span class="rag" style="background:%s"></span>%s' % (RAG[h["rag"]], h["rag"].upper())


def _items_table(rows, cols=("ref", "kind", "title", "owner", "status")):
    if not rows:
        return ""
    head = "".join("<th>%s</th>" % c for c in cols)
    body = "".join("<tr>%s</tr>" % "".join("<td>%s</td>" % e(r.get(c) if c != "category" else r.get("review")) for c in cols)
                   for r in rows)
    return "<table><tr>%s</tr>%s</table>" % (head, body)


def _decision_text(d):
    return d.get("title") if isinstance(d, dict) else d


def render(project_id):
    p = db.project_get(project_id)
    if not p:
        return None
    pub = db.project_public(p)
    ph = gov.project_health(pub)
    usage = db.usage([project_id])
    step_usage = _step_usage([r["id"] for r in pub["runs"]])
    rows = []
    for r in pub["runs"]:
        steps = []
        for s in r["steps"]:
            sm = s["summary"] or {}
            tests = sm.get("tests")
            v = s.get("verify")
            steps.append(
                '<div class="step"><div class="sh"><span class="ic" style="color:%s">%s</span> <span class="lane %s">%s</span> <b>%d. %s%s</b>'
                '<span class="st" style="color:%s">%s%s%s</span><span class="du">%s</span>%s</div>%s%s%s%s%s%s%s</div>' % (
                    COLOR.get(s["status"], "#aaa"), ICON.get(s["status"], "?"), e(s["lane"]), e(s["lane"]), s["position"],
                    e(s["groupName"]), " (attempt %d)" % s["attempt"] if s["attempt"] > 1 else "",
                    COLOR.get(s["status"], "#aaa"), e(s["status"]), " (forced)" if s["forced"] else "",
                    (" &middot; approved by %s" % e(s["approvedBy"])) if s.get("approvedBy") else "",
                    _dur(s["startedAt"], s["finishedAt"]), _spent(step_usage.get(s["id"])),
                    '<p>%s</p>' % e(sm.get("summary")) if sm.get("summary") else "",
                    '<p class="k">Decisions</p><ul>%s</ul>' % "".join("<li>%s</li>" % e(_decision_text(d)) for d in sm["decisions"]) if sm.get("decisions") else "",
                    '<p class="k">Artifacts</p><ul>%s</ul>' % "".join("<li><code>%s</code></li>" % e(a) for a in sm["artifacts"]) if sm.get("artifacts") else "",
                    '<p class="k">Tests (reported)</p><p><code>%s</code></p>' % e(json.dumps(tests)) if tests else "",
                    ('<p class="k">Server test run</p><p class="%s">%s &middot; <code>%s</code> &middot; exit %s</p>' % (
                        "ok" if v.get("passed") else "bad", "PASS" if v.get("passed") else "FAIL", e(v.get("command")), e(v.get("exit"))))
                    if v else "",
                    '<p class="k">Approval note</p><p>%s</p>' % e(s["approvalNote"]) if s.get("approvalNote") else "",
                    '<p class="err">%s</p>' % e(s["error"]) if s["error"] else ""))
        done = sum(1 for s in r["steps"] if s["status"] in ("done", "rework"))
        h = ph["runs"].get(str(r["id"])) or gov.run_health(r)
        scope = gov.scope_items(r["id"])
        regs = gov.items(run_id=r["id"], limit=200)
        rows.append(
            '<section class="run"><div class="rh"><span class="pill %s">%s #%d: %s</span><span class="st" style="color:%s">%s</span>'
            '<span class="du">%s &middot; %s / %d steps &middot; %s v%s &middot; owner %s &middot; priority %s &middot; due %s &middot; took %s</span>%s</div>'
            '<p class="du">%s</p>%s%s%s</section>' % (
                "bug" if r["kind"] == "bugfix" else "", "Bug fix" if r["kind"] == "bugfix" else "Feature", r["id"], e(r["title"]),
                COLOR.get(r["status"], "#aaa"), e(r["status"]), _rag(h), done, len(r["steps"]), e(r["workflowName"]),
                e(r.get("workflowVersion") or "-"), e(r["owner"] or "-"), e(r["priority"]), e(r["dueAt"] or "-"),
                _dur(r["createdAt"], r["finishedAt"]), _spent(usage["runs"].get(str(r["id"]))),
                e("; ".join(h["reasons"]) or "no problems"),
                ('<p class="k">Scope trace</p>' + _items_table(scope, ("ref", "text", "acceptance", "status", "evidence"))) if scope else "",
                ('<p class="k">Registers</p>' + _items_table(regs, ("ref", "kind", "title", "owner", "status", "severity", "category"))) if regs else "",
                "".join(steps)))
    pct = int(100 * pub["completed"] / pub["total"]) if pub["total"] else 0
    spent = _spent(usage["projects"].get(project_id))
    return """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Feature Report - %(name)s</title><style>%(css)s</style></head><body><main>
<h1>Feature Report - %(name)s</h1><div class="sub">Folder <code>%(folder)s</code> &middot; KH project <code>%(kh)s</code> &middot; owner %(owner)s &middot; generated %(now)s</div>
<div class="counts"><span>Health: %(rag)s</span><span>Total: %(total)d</span><span>Completed: %(completed)d</span><span>Doing: %(doing)d</span><span>Failed: %(failed)d</span>%(spent)s</div>
<p class="du">%(reasons)s</p>
<div class="bar"><i style="width:%(pct)d%%"></i></div>
%(rows)s
</main></body></html>""" % {"css": CSS, "name": e(p["name"]), "folder": e(p["folder"]), "kh": e(p["kh_project"]),
                         "owner": e(p["owner"] or "-"), "now": db.now(), "rag": _rag(ph), "reasons": e("; ".join(ph["reasons"])),
                         "total": pub["total"], "completed": pub["completed"], "doing": pub["doing"], "failed": pub["failed"],
                         "pct": pct, "spent": ("<span>Spent: %s%s</span>" % (spent, (" of $%.2f" % p["budget_usd"]) if p["budget_usd"] else ""))
                         if spent else "",
                         "rows": "".join(rows) or "<p class='sub'>No features yet.</p>"}


def status(project_id, days=7, audience="internal"):
    """The PM's one-page status for the last `days` days, drafted from the data."""
    p = db.project_get(project_id)
    if not p:
        return None
    client = audience == "client"
    days = max(1, min(92, int(days or 7)))
    since = db.ts_plus(-days * 24 * 60)
    pub = db.project_public(p)
    ph = gov.project_health(pub)
    finished = [r for r in pub["runs"] if r["status"] == "done" and (r["finishedAt"] or "") >= since]
    flight = [r for r in pub["runs"] if r["status"] in db.ACTIVE_RUN]
    reworks = db.one("SELECT COUNT(*) AS n FROM step_run s JOIN run r ON r.id=s.run_id WHERE r.project_id=? AND s.status='rework' "
                     "AND s.finished_at>=?", project_id, since)["n"]

    def run_line(r):
        cur = next((s for s in r["steps"] if s["position"] == r["currentPos"]), None)
        h = ph["runs"].get(str(r["id"])) or {"rag": "green", "reasons": []}
        nxt = cur["groupName"] if cur else "-"
        waiting = " (waiting for %s)" % ("approval" if cur and cur["status"] == "awaiting_approval" else "an answer") \
            if cur and cur["status"] in ("waiting_human", "awaiting_approval") else ""
        return "<tr><td>%s</td><td>#%d %s</td><td>%s%s</td><td>%s</td><td>%s</td></tr>" % (
            _rag(h), r["id"], e(r["title"]), e(nxt), e(waiting), e(r["dueAt"] or "-"), e("; ".join(h["reasons"]) or "-"))

    risks = [i for i in gov.items(project_id, "risk", "open") if i["category"] in (1, 2)][:5]
    decisions = gov.items(project_id, "decision", "proposed")[:8]
    changes = gov.items(project_id, "change", "active")[:8]
    esc = gov.items(project_id, "escalation", "open")[:5]
    defects = gov.items(project_id, "defect", "open")[:8]
    sections = [
        "<h2>Done this period (%d)</h2>" % len(finished),
        "<ul>%s</ul>" % "".join("<li>#%d %s (%s)</li>" % (r["id"], e(r["title"]), e(r["finishedAt"])) for r in finished) if finished
        else "<p class='sub'>Nothing finished in this period.</p>",
        "<h2>In flight and next (%d)</h2>" % len(flight),
        ("<table><tr><th>Health</th><th>Work</th><th>Current step</th><th>Due</th><th>Why</th></tr>%s</table>" % "".join(run_line(r) for r in flight))
        if flight else "<p class='sub'>Nothing in flight.</p>",
        "<h2>Top risks</h2>" + (_items_table(risks, ("ref", "title", "category", "mitigation", "owner")) or "<p class='sub'>No category 1-2 risks open.</p>"),
        "<h2>Changes</h2>" + (_items_table(changes, ("ref", "title", "status")) or "<p class='sub'>No open change requests.</p>"),
    ]
    if not client:
        sections += [
            "<h2>Decisions waiting for approval</h2>" + (_items_table(decisions, ("ref", "title", "createdBy")) or "<p class='sub'>None.</p>"),
            "<h2>Escalations</h2>" + (_items_table(esc, ("ref", "title", "owner")) or "<p class='sub'>None open.</p>"),
            "<h2>Open defects</h2>" + (_items_table(defects, ("ref", "title", "severity", "link")) or "<p class='sub'>None open.</p>"),
            "<h2>Quality</h2><p>%d piece(s) of work sent back by review, test or UAT in this period.</p>" % reworks,
        ]
        spent = db.spent_project(project_id)
        sections.append("<h2>Spend</h2><p>$%.2f%s spent on agent time in total.</p>" % (
            spent, (" of a $%.2f budget (%.0f%%)" % (p["budget_usd"], 100 * spent / p["budget_usd"])) if p["budget_usd"] else ""))
    return """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Status Report - %(name)s</title><style>%(css)s</style></head><body><main>
<h1>Status Report - %(name)s</h1>
<div class="sub">%(audience)s report for the last %(days)d day(s) &middot; owner %(owner)s &middot; generated %(now)s</div>
<div class="card" style="margin-top:14px"><b>Overall health: %(rag)s</b><p class="du">%(reasons)s</p>
<div class="counts"><span>Total: %(total)d</span><span>Completed: %(completed)d</span><span>In flight: %(doing)d</span></div></div>
%(sections)s
</main></body></html>""" % {"css": CSS, "name": e(p["name"]), "audience": "Client" if client else "Internal", "days": days,
                         "owner": e(p["owner"] or "-"), "now": db.now(), "rag": _rag(ph),
                         "reasons": e("; ".join(ph["reasons"]) or "no problems found"), "total": pub["total"],
                         "completed": pub["completed"], "doing": pub["doing"], "sections": "".join(sections)}
