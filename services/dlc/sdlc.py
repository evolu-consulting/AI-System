#!/usr/bin/env python
"""KH SDLC tool - server for the admin panel and the app.

  python sdlc.py init                    create sdlc.db and seed the default agents, groups, workflows
  python sdlc.py serve [--port] [--host] serve web/dist plus /api (default 127.0.0.1:8795)
  python sdlc.py user NAME --role admin  create a user and print its token (switches the tool to signed-in mode)

Python standard library only. The page is a built Vite bundle under web/dist,
served by this same process, so page and API share one origin.

WHO MAY DO WHAT. With no users the tool is a one-person local tool and every
caller is admin ("open mode"). Once a user exists every API call needs a token
(Authorization: Bearer, or ?token= for links opened in a new tab) and the role
decides: viewer reads; member starts work, chats, attaches, raises changes;
lead approves, rejects, pauses, cancels, edits registers and projects; admin
edits agents, groups, workflows, templates, users and settings. Every change is
written to the audit trail with who, what and when.
"""

import argparse
import json
import logging
import mimetypes
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import fe_bff  # noqa: E402  (settings first: they decide where the database lives)

# Frozen build (PyInstaller): bundled resources live in sys._MEIPASS, writable data next to the exe (or SDLC_DATA_DIR).
FROZEN = bool(getattr(sys, "frozen", False))
_data_dir = fe_bff.settings().get("SDLC_DATA_DIR") or (
    os.path.join(os.path.dirname(os.path.abspath(sys.executable)), "data") if FROZEN else "")
if _data_dir and not os.environ.get("SDLC_DB"):
    os.makedirs(_data_dir, exist_ok=True)
    os.environ["SDLC_DB"] = os.path.join(_data_dir, "sdlc.db")

import db  # noqa: E402
import fe_auth  # noqa: E402
import engine
import gov
import kh
import llm
import plan
import report
import seed
import toolbox

HERE = os.path.dirname(os.path.abspath(__file__))
RES = getattr(sys, "_MEIPASS", HERE) if FROZEN else HERE
DIST = os.environ.get("SDLC_WEB_DIST") or os.path.join(RES, "web", "dist")
DEFAULT_PORT = 8795

CFG = fe_bff.settings()
AUTH = fe_auth.AuthConfig(CFG.get("SDLC_AUTH_ISSUER", ""), CFG.get("SDLC_AUTH_CLIENT", "dlc-fe"),
                          CFG.get("SDLC_AUTH_AUDIENCE", ""))

log = logging.getLogger("sdlc")


class Forbidden(Exception):
    pass


class Unauthorized(Exception):
    pass


def _int(v, default=None):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


class Handler(BaseHTTPRequestHandler):
    server_version = "kh-sdlc/0.2"

    def log_message(self, fmt, *args):  # quiet: polling would flood the log
        pass

    # ------------------------------------------------------------ plumbing
    def _send(self, code, body, ctype):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json; charset=utf-8")

    def _raw(self):
        if not hasattr(self, "_raw_body"):
            n = int(self.headers.get("Content-Length") or 0)
            self._raw_body = self.rfile.read(n) if n else b""
        return self._raw_body

    def _body(self):
        if hasattr(self, "_cached"):
            return self._cached
        raw = self._raw()
        self._cached = {}
        if raw:
            try:
                self._cached = json.loads(raw.decode("utf-8")) or {}
            except ValueError:
                self._cached = {}
        return self._cached

    def _bearer(self, qs):
        auth = self.headers.get("Authorization") or ""
        return auth[7:].strip() if auth.lower().startswith("bearer ") else (qs.get("token") or "")

    def _kc_user(self, qs):
        """Keycloak mode: the access token decides who this is (raises fe_auth.AuthError)."""
        claims = fe_auth.verify(self._bearer(qs), AUTH)
        return fe_auth.user_of(claims, AUTH.client_id)

    def _parts(self):
        u = urllib.parse.urlsplit(self.path)
        parts = [urllib.parse.unquote(p) for p in u.path.split("/") if p]
        return parts, dict(urllib.parse.parse_qsl(u.query))

    def _static(self, parts):
        if not os.path.isdir(DIST):
            return self._send(503, "web/dist is not built: cd web && pnpm build", "text/plain")
        rel = os.path.normpath(os.path.join(DIST, *parts)) if parts else os.path.join(DIST, "index.html")
        if not rel.startswith(DIST) or not os.path.isfile(rel):
            rel = os.path.join(DIST, "index.html")
        with open(rel, "rb") as f:
            data = f.read()
        self._send(200, data, mimetypes.guess_type(rel)[0] or "application/octet-stream")

    def _user(self, qs):
        if AUTH.enabled:
            return self._kc_user(qs)
        if gov.open_mode():
            return dict(gov.LOCAL)
        auth = self.headers.get("Authorization") or ""
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else (self.headers.get("X-SDLC-Token") or qs.get("token") or "")
        return gov.user_by_token(token)

    def need(self, role):
        if gov.rank(self.user["role"]) < gov.rank(role):
            raise Forbidden("this needs the %s role (you are %s)" % (role, self.user["role"]))

    def _route(self, method):
        parts, qs = self._parts()
        if not parts or parts[0] != "api":
            if method == "GET":
                return self._static(parts)
            return self._json(404, {"error": "not found"})
        p = parts[1:]
        try:
            if p == ["health"]:
                return self._json(200, {"ok": True, "dist": os.path.isdir(DIST), "claude": bool(llm.which("claude")),
                                        "kh": kh.health(), "openMode": gov.open_mode()})
            if p and p[0] == "fe":
                return self._fe(method, p[1:], qs)
            if p and p[0] == "dlc":
                return self._dlc(method, p[1:])
            if p == ["login"] and method == "POST":
                u = gov.user_by_token(str(self._body().get("token") or ""))
                if not u:
                    return self._json(401, {"error": "unknown or disabled token"})
                gov.audit(u["name"], "login", "user", u["id"])
                return self._json(200, {"user": u})
            self.user = self._user(qs)
            if not self.user:
                raise Unauthorized("sign in with your token")
            self.need("viewer")
            if method != "GET" and p != ["notifications", "read"]:
                self.need("member")
            out = self._api(method, p, qs)
            if method != "GET":
                body = {k: ("<%d chars>" % len(v) if isinstance(v, str) and len(v) > 300 else v)
                        for k, v in self._body().items() if k not in ("data", "env", "token")}
                gov.audit(self.user["name"], "%s /%s" % (method, "/".join(p)), p[0] if p else "", p[1] if len(p) > 1 else "", body)
            return out
        except fe_auth.AuthError as exc:
            return self._json(exc.status, {"error": str(exc)})
        except Unauthorized as exc:
            return self._json(401, {"error": str(exc)})
        except Forbidden as exc:
            return self._json(403, {"error": str(exc)})
        except KeyError as exc:
            return self._json(404, {"error": "not found", "detail": str(exc)})
        except ValueError as exc:
            return self._json(422, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            log.exception("api error")
            return self._json(500, {"error": "server error", "detail": str(exc)})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")

    def do_DELETE(self):
        self._route("DELETE")

    # ------------------------------------------------------------ default frontend (DLC engine)
    def _origin(self):
        if CFG.get("SDLC_PUBLIC_URL"):
            return CFG["SDLC_PUBLIC_URL"].rstrip("/")
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "127.0.0.1:%d" % DEFAULT_PORT
        proto = self.headers.get("X-Forwarded-Proto") or "http"
        return "%s://%s" % (proto, host)

    def _fe(self, method, p, qs):
        """Public frontend config, the user's identity, and the seeded flow catalogue."""
        fpath = fe_bff.flows_path(CFG, db.DB)
        if p == ["config"] and method == "GET":
            return self._json(200, {"version": fe_bff.VERSION, "auth": AUTH.public(), "public_url": self._origin(),
                                    "engine": bool(fe_bff.engine_url(CFG))})
        user = self._kc_user(qs) if AUTH.enabled else dict(gov.LOCAL)
        if p == ["me"] and method == "GET":
            return self._json(200, {"user": user, "auth": AUTH.enabled})
        if p == ["flows"] and method == "GET":
            return self._json(200, {"flows": fe_bff.load_flows(fpath, CFG.get("SDLC_ENABLE_MIGRATION") == "1")})
        if len(p) == 2 and p[0] == "flows" and method == "PUT":
            if gov.rank(user["role"]) < gov.rank("admin"):
                raise Forbidden("editing flows needs the admin role")
            return self._json(200, {"flow": fe_bff.update_flow(fpath, p[1], self._body())})
        return self._json(404, {"error": "no route", "path": "/api/fe/" + "/".join(p)})

    def _dlc(self, method, p):
        """Proxy to the DLC engine. In sign-in mode the token is checked here first, then forwarded."""
        if AUTH.enabled:
            fe_auth.verify(self._bearer({}), AUTH)
        split = urllib.parse.urlsplit(self.path)
        rest = split.path.split("/api/dlc/", 1)[1] if "/api/dlc/" in split.path else ""
        body = self._raw() if method in ("POST", "PUT") else b""
        status, headers, data = fe_bff.proxy(CFG, method, rest, split.query, body, dict(self.headers.items()))
        self.send_response(status)
        for k, v in headers.items():
            if k.lower() not in ("cache-control",):
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # ------------------------------------------------------------ helpers
    def _run_full(self, r):
        pub = db.run_public(r)
        pub["health"] = gov.run_health(pub)
        pub["scope"] = gov.scope_items(r["id"])
        pub["attachments"] = gov.attachments(r["id"])
        pub["registers"] = gov.items(run_id=r["id"], limit=200)
        for st, row in zip(pub["steps"], db.steps_of(r["id"])):
            required, need = engine.step_signoff(r, row)
            st["signoffs"] = gov.signoffs("step:%d" % row["id"])
            st["approvers"] = required
            st["waitingFor"] = need if row["status"] == "awaiting_approval" else []
            st["env"] = (engine.step_group(r, row)[0] or {}).get("env") or ""
        if r["depends_on"]:
            dep = db.run_get(r["depends_on"])
            pub["dependsOnStatus"] = dep["status"] if dep else None
        return pub

    def _project_full(self, pr):
        pub = db.project_public(pr)
        h = gov.project_health(pub)
        pub["health"] = {"rag": h["rag"], "reasons": h["reasons"], "spent": h["spent"]}
        for r in pub["runs"]:
            r["health"] = h["runs"].get(str(r["id"]))
        pub["open"] = gov.counts(pr["id"])
        return pub

    # ------------------------------------------------------------ API
    def _api(self, m, p, qs):
        J = self._json
        n = len(p)
        me = self.user["name"]
        if p == ["me"]:
            return J(200, {"user": self.user, "openMode": gov.open_mode()})
        if p == ["llm"]:
            return J(200, {"providers": llm.catalogue()})
        if p == ["tools"]:
            cat, problem = toolbox.catalogue(engine.TOOLS_DIR)
            rows = [t for t in ((cat or {}).get("tools") or []) if t["onDisk"] and not t["retired"]]
            return J(200, {"tools": [{"key": t["key"], "name": t["name"], "work": t["work"][:300]} for t in rows],
                           "error": problem})

        # ---- admin: agents / groups / workflows / templates
        for coll, lst, get, save, delete in (
            ("agents", db.agents, lambda i: db.agent_public(db.agent_row(i)), db.save_agent, db.delete_agent),
            ("groups", db.groups, db.group_get, db.save_group, db.delete_group),
            ("workflows", db.workflows, db.workflow_get, lambda i, b: db.save_workflow(i, b, me), db.delete_workflow),
            ("templates", db.templates, db.template_get, db.save_template, db.delete_template),
        ):
            if p and p[0] == coll:
                if m != "GET":
                    self.need("admin")
                if n == 1 and m == "GET":
                    return J(200, {"items": lst()})
                if n == 1 and m == "POST":
                    return J(201, save(None, self._body()))
                if n == 3 and coll == "workflows" and p[2] == "versions" and m == "GET":
                    return J(200, {"items": db.workflow_versions(p[1])})
                if n == 2:
                    item = get(p[1])
                    if m == "GET":
                        return J(200, item) if item else J(404, {"error": "not found"})
                    if m == "PUT":
                        return J(200, save(p[1], self._body()))
                    if m == "DELETE":
                        delete(p[1])
                        return J(200, {"deleted": p[1]})

        # ---- admin: users, settings, audit
        if p and p[0] == "users":
            self.need("admin")
            if n == 1 and m == "GET":
                return J(200, {"items": gov.users()})
            if n == 1 and m == "POST":
                return J(201, gov.save_user(None, self._body()))
            if n == 2 and m == "PUT":
                return J(200, gov.save_user(p[1], self._body()))
        if p == ["settings"]:
            if m == "GET":
                return J(200, gov.settings())
            if m == "PUT":
                self.need("admin")
                return J(200, gov.save_settings(self._body()))
        if p == ["audit"] and m == "GET":
            self.need("lead")
            return J(200, {"items": gov.audit_page(_int(qs.get("limit"), 200), qs.get("entity"))})
        if p == ["audit.csv"] and m == "GET":
            # SoX evidence: every change and every sign-off, who and when, as a file an auditor can keep.
            self.need("lead")
            import csv
            import io
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["id", "ts", "actor", "action", "entity", "entity_id", "detail"])
            for a in reversed(gov.audit_page(100000)):
                w.writerow([a["id"], a["ts"], a["actor"], a["action"], a["entity"], a["entityId"], a["detail"]])
            data = buf.getvalue().encode("utf-8-sig")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="sdlc-audit.csv"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return None
        if p == ["plan-templates"] and m == "GET":
            return J(200, {"items": plan.templates()})
        if n >= 2 and p[0] == "tasks":
            t = plan.get(_int(p[1]))
            if not t:
                raise KeyError(p[1])
            if m == "PUT":
                b = self._body()
                structural = set(b) - {"pct", "status", "owner", "details", "actualEnd", "invoiceSent"}
                if structural or "invoiceSent" in b:
                    self.need("lead")
                plan.update(t["id"], b)
                return J(200, plan.schedule(t["projectId"]))
            if m == "DELETE":
                self.need("lead")
                plan.delete(t["id"])
                return J(200, plan.schedule(t["projectId"]))

        # ---- notifications, portfolio, cross-project registers
        if p == ["notifications"] and m == "GET":
            return J(200, gov.notifications(self.user, unread_only=qs.get("unread") == "1"))
        if p == ["notifications", "read"] and m == "POST":
            gov.mark_read(self.user, self._body().get("ids"))
            return J(200, {"ok": True})
        if p == ["portfolio"] and m == "GET":
            return J(200, {"items": gov.portfolio(), "settings": gov.settings()})
        if p == ["registers"] and m == "GET":
            return J(200, {"items": gov.items(qs.get("project"), qs.get("kind"), qs.get("status"), _int(qs.get("run")))})
        if n >= 2 and p[0] == "registers":
            item = gov.item_get(_int(p[1]))
            if not item:
                raise KeyError(p[1])
            if n == 2 and m == "PUT":
                self.need("lead")
                return J(200, gov.update_item(item["id"], self._body(), me))
            if n == 3 and p[2] == "decide" and m == "POST":
                b = self._body()
                return J(200, engine.decide_change(item["id"], bool(b.get("approve")), self.user,
                                                   b.get("rerunFrom") if "rerunFrom" in b else None, str(b.get("note") or "")))
            if n == 3 and p[2] == "bugfix" and m == "POST":
                if item["kind"] not in ("defect", "issue"):
                    raise ValueError("only a defect or issue can start a bug fix")
                b = self._body()
                rid = db.create_run(item["projectId"], b.get("workflowId") or "wf-bug-fix", "%s: %s" % (item["ref"], item["title"]),
                                    owner=b.get("owner") or me, created_by=me, external_key=item["ref"], priority=b.get("priority") or 2)
                gov.update_item(item["id"], {"link": "run #%d" % rid}, me)
                engine.wake(item["projectId"])
                return J(201, {"runId": rid})

        # ---- app: projects
        if p == ["projects"] and m == "GET":
            page = db.projects_page(_int(qs.get("page"), 1), _int(qs.get("per"), 2))
            page["items"] = [self._project_full(db.project_get(x["id"])) for x in page["items"]]
            return J(200, page)
        if p == ["projects"] and m == "POST":
            b = self._body()
            name = str(b.get("name") or "").strip()
            folder = str(b.get("folder") or "").strip()
            if not name or not folder:
                raise ValueError("name and folder are required")
            tpl = db.template_get(b["templateId"]) if b.get("templateId") else None
            src = db.project_get(b["duplicateOf"]) if b.get("duplicateOf") else None
            base = {"owner": me, "budget": 0, "test": "", "jira": "", "wf": "wf-new-system"}
            if tpl:
                base.update(budget=tpl["budgetUsd"], test=tpl["testCommand"], wf=tpl["workflowId"])
            if src:
                base.update(owner=src["owner"] or me, budget=src["budget_usd"], test=src["test_command"], jira=src["jira_base"])
            os.makedirs(folder, exist_ok=True)
            proj = db.create_project(name, os.path.normpath(folder), owner=str(b.get("owner") or base["owner"]),
                                     budget_usd=b.get("budgetUsd", base["budget"]), test_command=str(b.get("testCommand") or base["test"]),
                                     jira_base=str(b.get("jiraBase") or base["jira"]), template_id=str(b.get("templateId") or ""))
            kh.ensure_project(proj["kh_project"], name, proj["folder"])
            rid = db.create_run(proj["id"], b.get("workflowId") or base["wf"], str(b.get("title") or name), owner=proj["owner"],
                                created_by=me, priority=b.get("priority") or 3, due_at=b.get("dueAt") or None,
                                budget_usd=b.get("runBudgetUsd") or 0, external_key=str(b.get("externalKey") or ""))
            engine.wake(proj["id"])
            return J(201, {"projectId": proj["id"], "runId": rid})
        if n >= 2 and p[0] == "projects":
            pr = db.project_get(p[1])
            if not pr:
                raise KeyError(p[1])
            if n == 2 and m == "GET":
                return J(200, self._project_full(pr))
            if n == 2 and m == "PUT":
                self.need("lead")
                db.update_project(pr["id"], self._body())
                return J(200, self._project_full(db.project_get(pr["id"])))
            if n == 3 and p[2] == "runs" and m == "POST":
                b = self._body()
                title = str(b.get("title") or "").strip()
                if not title:
                    raise ValueError("title is required")
                rid = db.create_run(pr["id"], b.get("workflowId"), title, owner=str(b.get("owner") or me), created_by=me,
                                    priority=b.get("priority") or 3, due_at=b.get("dueAt") or None, budget_usd=b.get("budgetUsd") or 0,
                                    external_key=str(b.get("externalKey") or ""), epic=str(b.get("epic") or ""),
                                    depends_on=b.get("dependsOn") or None)
                engine.wake(pr["id"])
                return J(201, {"runId": rid})
            if n >= 3 and p[2] == "plan":
                if n == 3 and m == "GET":
                    return J(200, plan.schedule(pr["id"]))
                self.need("lead")
                b = self._body()
                if n == 4 and p[3] == "tasks" and m == "POST":
                    plan.add(pr["id"], b)
                elif n == 4 and p[3] == "generate" and m == "POST":
                    plan.generate(pr["id"], b.get("template") or "smdg-phase", str(b.get("name") or ""), b.get("streams") or [],
                                  b.get("start") or None, b.get("after") or None, bool(b.get("skipPrep")))
                elif n == 4 and p[3] == "from-run" and m == "POST":
                    plan.generate_from_run(int(b.get("runId") or 0))
                elif n == 4 and p[3] == "baseline" and m == "POST":
                    return J(200, plan.set_baseline(pr["id"]))
                else:
                    return J(404, {"error": "no route"})
                return J(201, plan.schedule(pr["id"]))
            if n == 3 and p[2] == "report":
                return self._send(200, report.render(pr["id"]), "text/html; charset=utf-8")
            if n == 3 and p[2] == "status":
                return self._send(200, report.status(pr["id"], _int(qs.get("days"), 7), qs.get("audience") or "internal"),
                                  "text/html; charset=utf-8")
            if n == 3 and p[2] == "registers":
                if m == "GET":
                    return J(200, {"items": gov.items(pr["id"], qs.get("kind"), qs.get("status"), _int(qs.get("run")))})
                if m == "POST":
                    b = self._body()
                    if b.get("kind") == "change" and b.get("runId"):
                        return J(201, engine.raise_change(int(b["runId"]), b.get("title"), str(b.get("detail") or ""), me))
                    return J(201, gov.add_item(pr["id"], b.get("kind"), b.get("title"), detail=b.get("detail") or "",
                                               run_id=b.get("runId"), owner=b.get("owner") or "", probability=b.get("probability"),
                                               impact=b.get("impact"), mitigation=b.get("mitigation") or "",
                                               severity=b.get("severity") or "", due_at=b.get("dueAt"), link=b.get("link") or "",
                                               created_by=me))
        if p == ["usage"] and m == "GET":
            return J(200, db.usage([x for x in (qs.get("projects") or "").split(",") if x]))

        # ---- app: runs
        if p and p[0] == "runs" and n >= 2:
            r = db.run_get(_int(p[1]))
            if not r:
                raise KeyError(p[1])
            rid = r["id"]
            if n == 2 and m == "GET":
                return J(200, {"run": self._run_full(r), "project": self._project_full(db.project_get(r["project_id"]))})
            if n == 2 and m == "PUT":
                self.need("lead")
                b = self._body()
                for key, col, cast in (("priority", "priority", lambda v: max(1, min(5, int(v)))), ("dueAt", "due_at", str),
                                       ("owner", "owner", str), ("budgetUsd", "budget_usd", float), ("epic", "epic", str),
                                       ("externalKey", "external_key", str),
                                       ("dependsOn", "depends_on", lambda v: int(v) if v else None)):
                    if key in b:
                        val = cast(b[key]) if b[key] not in (None, "") or key in ("epic", "externalKey", "owner") else None
                        if key == "dependsOn" and val and (val == rid or not db.run_get(val)):
                            raise ValueError("depends on an unknown run")
                        db.ex("UPDATE run SET %s=? WHERE id=?" % col, val, rid)
                engine.wake(r["project_id"])
                return J(200, {"run": self._run_full(db.run_get(rid))})
            if n == 3 and p[2] in ("pause", "resume", "cancel") and m == "POST":
                self.need("lead")
                if p[2] == "cancel":
                    engine.cancel(rid, me, str(self._body().get("reason") or ""))
                else:
                    getattr(engine, p[2])(rid, me)
                return J(200, {"run": self._run_full(db.run_get(rid))})
            if n == 3 and p[2] == "messages" and m == "POST":
                content = str(self._body().get("content") or "").strip()
                if not content:
                    raise ValueError("empty message")
                return J(201, {"seq": engine.post_human(rid, content, by=me)})
            if n == 3 and p[2] == "history":
                steps = [dict(db.step_public(s), messages=db.messages(s["id"])) for s in db.steps_of(rid)]
                return J(200, {"run": db.run_public(r, False), "steps": steps})
            if n == 3 and p[2] == "attachments":
                if m == "GET":
                    return J(200, {"items": gov.attachments(rid)})
                b = self._body()
                a = gov.save_attachment(r, db.project_get(r["project_id"]), b.get("name"), b.get("data"), me)
                if r["status"] in ("pending", "running", "waiting_human"):
                    engine.post_human(rid, "I attached %s (%d bytes): %s" % (a["name"], a["size"], a["path"]), by=me)
                return J(201, a)
            if n == 3 and p[2] == "changes" and m == "POST":
                b = self._body()
                return J(201, engine.raise_change(rid, b.get("title"), str(b.get("detail") or ""), me))
            if n == 3 and p[2] == "jira" and m == "POST":
                key = str(self._body().get("key") or r["external_key"] or "").strip().upper()
                issue = gov.jira_fetch(db.project_get(r["project_id"])["jira_base"], key)
                db.ex("UPDATE run SET external_key=? WHERE id=?", key, rid)
                if r["status"] in ("pending", "running", "waiting_human"):
                    engine.post_human(rid, "Jira %s (%s, %s, %s): %s\n%s\n%s" % (
                        issue["key"], issue["type"], issue["status"], issue["priority"], issue["summary"],
                        issue["description"][:6000], issue["url"]), by=me)
                return J(200, issue)
            if n == 4 and p[2] == "scope" and m == "PUT":
                self.need("lead")
                return J(200, {"items": gov.update_scope(rid, p[3], self._body())})
            if n >= 4 and p[2] == "steps":
                s = db.one("SELECT * FROM step_run WHERE run_id=? AND position=?", rid, _int(p[3], 0))
                if not s:
                    raise KeyError(p[3])
                b = self._body() if m != "GET" else {}
                if n == 5 and p[4] == "messages" and m == "GET":
                    return J(200, {"status": s["status"], "step": db.step_public(s),
                                   "messages": db.messages(s["id"], _int(qs.get("after"), 0))})
                if n == 5 and p[4] == "proceed" and m == "POST":
                    engine.proceed(rid, s["position"])
                    return J(200, {"ok": True})
                if n == 5 and p[4] == "retry" and m == "POST":
                    engine.retry(rid, s["position"])
                    return J(200, {"ok": True})
                if n == 5 and p[4] == "approve" and m == "POST":
                    # A titled sign-off (business lead, pmo, client ...) may be given by whoever holds the title.
                    out = engine.approve(rid, s["position"], self.user, str(b.get("note") or ""), b.get("title") or None)
                    return J(200, dict({"ok": True}, **(out or {})))
                if n == 5 and p[4] == "reject" and m == "POST":
                    engine.reject(rid, s["position"], self.user, str(b.get("note") or ""), bool(b.get("sendBack")))
                    return J(200, {"ok": True})
                if n == 5 and p[4] == "rerun" and m == "POST":
                    self.need("lead")
                    when = engine.rerun_from(rid, s["position"], "re-run requested by %s: %s" % (me, b.get("reason") or "no reason given"))
                    return J(200, {"ok": True, "when": when})
        return J(404, {"error": "no route", "path": "/api/" + "/".join(p)})


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    sv = sub.add_parser("serve")
    sv.add_argument("--port", type=int, default=int(CFG.get("SDLC_PORT") or DEFAULT_PORT))
    sv.add_argument("--host", default=CFG.get("SDLC_HOST") or "127.0.0.1",
                    help="0.0.0.0 to share on the network (needs sign-in: SDLC_AUTH_ISSUER, or create users first)")
    sf = sub.add_parser("seed-flows", help="add the default flows (New System, Enhancement, Bug Fix) if missing")
    sf.add_argument("--force", action="store_true", help="reset the flow catalogue to the defaults")
    sub.add_parser("version")
    us = sub.add_parser("user")
    us.add_argument("name")
    us.add_argument("--role", default="admin", choices=gov.ROLES)
    us.add_argument("--email", default="")
    a = ap.parse_args()
    if a.cmd == "version":
        print("dlc-fe", fe_bff.VERSION)
        return
    db.init_db()
    seed.seed()
    fpath = fe_bff.flows_path(CFG, db.DB)
    if a.cmd == "seed-flows":
        added, kept = fe_bff.seed_flows(fpath, force=a.force)
        print("flows: %d added, %d kept (%s)" % (added, kept, fpath))
        return
    fe_bff.seed_flows(fpath)
    if a.cmd == "init":
        print("ready:", db.DB)
        return
    if a.cmd == "user":
        u = gov.save_user(None, {"name": a.name, "role": a.role, "email": a.email})
        gov.audit("cli", "create user", "user", u["id"], {"role": a.role})
        print("user %s (%s) token: %s" % (u["name"], u["role"], u["token"]))
        return
    if a.host not in ("127.0.0.1", "localhost") and gov.open_mode() and not AUTH.enabled:
        sys.exit("refusing to serve on %s in open mode: create a user first (python sdlc.py user NAME --role admin)" % a.host)
    engine.start()
    srv = Server((a.host, a.port), Handler)
    log.info("SDLC serving on http://%s:%d (engine %s, sign-in %s)", a.host, a.port,
             fe_bff.engine_url(CFG) or "not set", "on" if AUTH.enabled else "off")
    srv.serve_forever()


if __name__ == "__main__":
    main()
