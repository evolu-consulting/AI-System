# Frontend integration guide (for a coding agent)

This guide is written for an LLM coding agent (or an engineer) who must connect **your own frontend** to the
**DLC engine** installed on your host. It is self-contained: everything you need is the engine's HTTP API, this
guide, and the machine-readable contract served by the engine at `GET /api/openapi.json`. You never need, and
will not receive, the engine's source code.

Read sections 1-3 first, implement the journeys you need from section 5, then prove the integration with the
smoke tests in section 10.

---

## 1. What you receive

From the operator who installed the engine:

| Item | Example | Notes |
|---|---|---|
| Engine base URL | `http://10.0.0.12:8796` | call it from your **frontend's backend** |
| Sign-in (OIDC issuer) | `https://10.0.0.12:8443/realms/dlc` | Keycloak realm `dlc`; discovery at `<issuer>/.well-known/openid-configuration` |
| Your OIDC client id | `customer-fe` | a public client, authorization code + PKCE (S256) |
| Redirect URI(s) registered for you | `http://10.0.0.20:3000/*` | ask the operator to change them if your URL differs |
| Audience the engine requires | `dlc-api` | your client adds it to every access token |
| Roles | `dlc-user` (use the engine), `dlc-admin` (also cancel runs, stop apps), `dlc-viewer` (read only in the default frontend) | realm roles, in `realm_access.roles` |
| Test account | `demo` / (given separately) | for your smoke tests |
| Version | `dlc 0.1.0` | `GET /api/health` -> `version` |
| Board URL | `http://10.0.0.12:8796/` | the engine's own progress UI (optional embed, section 6) |

`GET /api/auth/config` (no token needed) returns the same sign-in settings as JSON:
`{"enabled": true, "issuer": "...", "client_id": "dlc-fe", "audience": "dlc-api", "role_user": "dlc-user", "role_admin": "dlc-admin"}`.

## 2. Security model (read before writing code)

- **Every `/api` route except `/api/health`, `/api/openapi.json` and `/api/auth/config` needs
  `Authorization: Bearer <access token>`** issued by the realm above. The engine checks the signature (realm
  keys, RS256), issuer, expiry, the audience `dlc-api` and the role `dlc-user`; cancel and app stop also need
  `dlc-admin`.
  - `401 {"code": "UNAUTHENTICATED", ...}`: no token, bad signature, expired, wrong issuer -> sign the user in
    again or refresh the token, then retry once.
  - `403 {"code": "FORBIDDEN", ...}`: valid user without the role or the audience -> do not retry; the
    operator grants the role in the realm.
- **Sign users in with authorization code + PKCE** on your client `customer-fe`; never use the password grant.
  Recommended shape (backend-for-frontend): your backend runs the code exchange, keeps the access and refresh
  tokens server side (session cookie to the browser), refreshes them before `exp`, and calls the engine with
  the user's access token. The engine records the user (`preferred_username`) on runs and answers.
  A pure single-page app can also run PKCE in the browser and send the token to its backend; never put tokens
  in URLs or logs.
- **The sign-in server uses HTTPS** (its cookies are `Secure`). With a self-signed certificate, your backend
  must trust it (the operator gives you the certificate file) and users accept it once in the browser, or the
  operator installs a real certificate.
- **Call the engine from your backend**, not from the browser. Only if you must call it from a browser, the
  operator lists your origin in `LINE_CORS_ORIGINS`; other origins get no CORS headers and their preflight
  (`OPTIONS`) answers 403.
- `GET /api/me` with the token returns `{"enabled": true, "actor": "<user>", "roles": [...], "admin": false}`:
  use it after sign-in to show what the user may do.

## 3. Contract and conventions

- `GET /api/health` -> `{"ok": true, "service": "sdlc-line", "version": "0.1.0", "host", "port", "last_seq",
  "time_ms", "driver": true}`. `driver: false` means this engine cannot start runs (POST routes answer 501).
- `GET /api/openapi.json` -> OpenAPI 3 description of **every** route with request and response schemas. It is
  generated from the same table the server routes by: any `/api` path not in it answers 404. Generate your
  client from it if you like; this guide adds the meaning and the order of calls.
- JSON in and out, UTF-8. Times are epoch milliseconds (`*_ms`). Ids are opaque strings
  (`R20261011-184349-d8f4`, `M20261011-190229-bbf8`, `U1`, `F1`, `C1`).
- Errors: `{"code": "...", "message": "...", "detail": {...}}` with HTTP 400 / 404 / 409 / 501 / 500
  (section 8). The run answers route wraps it: `{"error": {"code", "message", "detail"}, "results": [...]}`.

## 4. Concepts in one paragraph

A **project** is one application the engine keeps a git repository for, in a folder it chooses on its own host
(your frontend never sees or sends server paths). A **spec pack** is a folder on the engine host holding
`spec.md` (the requirements; features are written as `## F1 ...`, `## F2 ...` with testable criteria). A **run**
applies one pack to a project's repository and goes through states until it is final: `green` (done: tests pass,
merged, deployed to the engine's QAS slot) or `escalated` (stopped with a reason). A project's first run is New
System; later Enhancement and Bug Fix runs build on the same repository, so the application grows run by run.
Several Enhancement and Bug Fix runs of one project may run at the same time: they analyse and plan in parallel,
then build, test, merge and deliver one at a time in the order they started (the project's **change queue**,
`GET /api/projects/{id}/queue`). A New System or a migration runs alone on its project. Inside a run the work is split into **units** (each builds a few files), checked
by **gates**, merged in order. A run can **park** to ask a person **questions**; answering them resumes it. When
the operator runs the engine with `human_mode=decide` (or you start a run with `"human_mode": "decide"`), nobody
is asked: the model decides and logs each decision, which you show from the work log (5.7). A **feature
migration** compares an old version (v1) with a rewrite (v2), asks about conflicts, and builds what v2 lacks.

## 5. Journeys

Long work never blocks an HTTP request: every `POST` that starts work returns at once (`202`) with an id, and
you poll (section 7).

### 5.0 Projects (home page)

UI: a list of projects (name, state of the current or last run, "Open app" when one has completed), a
"New Project" button, and on each project a "New" menu with the flows. Open a project to list its runs.

```
GET  /api/projects                 -> {"projects": [{"id", "name", "description", "runs", "has_code",
                                       "active_run" | null, "last_run" | null, "last_green_run", "updated_ms"}]}
POST /api/projects {"name": "Order Portal", "description": "..."}   -> 201 {"id": "order-portal", ...}
GET  /api/projects/{id}            -> {"project": {...}, "runs": [run summary, newest first]}
```

Enable the flows from the project state: New System while `has_code` is false; Enhancement and Bug Fix once
`has_code` is true (a run completed). While runs are in progress (`live_runs`), Enhancement and Bug Fix stay
enabled when every live run is an Enhancement or a Bug Fix (they join the change queue); New System never starts
next to a live run. The engine enforces the same rules and answers `409 STATE_CONFLICT` otherwise.

### 5.1 New System from an uploaded .md spec

UI: create the project (or pick a new one), upload a `.md` file (or paste text), click "Build".

```
POST /api/packs
{"kind": "new", "name": "order-portal", "spec": "<the markdown text of the uploaded file>"}
-> 201 {"pack": "<pack path on the engine host>", "kind": "new", "name": "order-portal", "chars": 812}

POST /api/runs
{"pack": "<pack from above>", "project": "order-portal", "flow": "new-system", "name": "order-portal"}
-> 202 {"run": "R20261011-184349-d8f4", "state": "admitted"}
```

Pass the `pack` value back unchanged (it is opaque to you). Then show progress (5.4).

### 5.2 Enhancement (add or change features of a project)

UI: on a built project choose "Enhancement", give the feature a name and upload the change spec.

```
POST /api/packs  {"kind": "enhance", "name": "export-csv", "spec": "<markdown>"}                       -> 201 {"pack": ...}
POST /api/runs   {"pack": "<pack>", "project": "order-portal", "flow": "enhancement", "name": "export-csv"}  -> 202 {"run", "state"}
```

The engine commits acceptance tests and merged units to the project's repository; the next run starts from there.

### 5.3 Bug Fix

UI: on a built project choose "Bug Fix": a form with title, steps to reproduce, expected, actual, optional context.

```
POST /api/packs
{"kind": "bug", "title": "Empty task text is accepted", "repro": "run: todo add \"\"",
 "expected": "exit 1 with 'error: empty text'", "actual": "an empty task is saved", "context": ""}
-> 201 {"pack": ...}
POST /api/runs {"pack": "<pack>", "project": "order-portal", "flow": "bug-fix", "name": "empty-task"}   -> 202 {"run", "state"}
```

The engine writes the bug as one feature (`F1` = the expected behaviour) and keeps everything else unchanged.

### 5.4 Progress view

| Need | Call | Use |
|---|---|---|
| list of runs | `GET /api/runs` -> `{"runs": [summary]}` | `id, state, pack_path, created_ms, updated_ms, budget_usd, units, unit_states {merged: 3, ...}, detail {target, model, spent_usd}` |
| one run | `GET /api/runs/{run}` | `run` (summary), `units[]` (`id, title, state, wave, f_items, tests, claims, attempt`), `gates[]` (`name, unit, attempt, ok, code`), `budget` (`limit, spent, ratio`), `merge[]`, `deploy[]`, `qas[]` (`f_item, verdict`), `escalations[]` |
| live feed | `GET /api/runs/{run}/events?after_seq=N&limit=500` | `events[]` with `seq, kind, env {run, unit, attempt}, body, ts_ms`; keep the highest `seq` you saw and pass it as `after_seq` next time |
| lanes like the board | `GET /api/board?run={run}` | `lanes` (feature x stage), `units`, `gates`, `qas`, `human` (open questions) |

Final states: `green`, `escalated`. Everything else is in progress (`admitted, understanding, planning,
building, integrating, testing, deploying ...`, plus `parked` while waiting for answers). Show
`escalations[].code` and `message` when a run escalates; useful codes are in section 8.

### 5.5 Questions: park -> answer -> resume

```
GET /api/runs/{run}/questions
-> {"run": "...", "parked": true, "park": {...},
    "questions": [{"qid": "Q1", "state": "open", "kind": "gap", "decision": "What is the loan period?",
                   "options": [{"id": "a", "text": "14 days", "impact": "..."},
                               {"id": "b", "text": "30 days", "impact": "..."}],
                   "recommended": "a", "evidence": [{"span_id": "...", "quote": "..."}], "f_items": ["F3"],
                   "due_ms": 1791800000000}]}

POST /api/runs/{run}/answers
{"who": "jane@yourco.com", "answers": [{"qid": "Q1", "option": "a"}, {"qid": "Q2", "option": "other", "text": "21 days"}]}
-> 200 {"results": [...], "remaining": 0, "addendum": "v1.1", "version": "...", "resume": true, "resumed": {...}}
```

Render each open question (`state` `open` or `held`) with `decision` as the question and its options (`text`,
`impact`; mark `recommended`); allow free text with option `other` when your UI offers it. `who` is required
(400 without it); a question already answered answers 409.
When `remaining` reaches 0 the engine resumes the run by itself (`resume: true`). Show questions whenever
`GET /api/runs/{run}/questions` says `parked: true`; poll it together with the run.

### 5.6 Pause, resume, cancel

- **Pause at any time** (a "Stop" button): `POST /api/runs/{run}:pause {"reason": "..."}` ->
  `200 {"run", "state", "paused": true, "stopping": true}`. Builders finish their current step and stop; the run
  keeps its state and survives an engine restart. `run.paused` is `true` in every summary while paused.
- **Resume** (a "Resume" button): `POST /api/runs/{run}:resume {}` -> `200 {"run", "state", "resuming": true}`;
  it continues from where it stopped. Also works for a run that stopped for another non-final reason.
- **Cancel** (admin role): `POST /api/runs/{run}:cancel {"reason": "user cancelled"}` ->
  `200 {"run", "state", "cancelling"}`. A cancelled run ends `escalated` with code `CANCELLED` and cannot resume.

Show one toggle: running -> Pause, `paused: true` -> Resume; hide both on final states.

### 5.7 Stages, agent work log and reports (a run's detail page)

```
GET /api/runs/{run}/nodes
-> {"run", "state", "paused", "nodes": [{"id": "understand" | "tests" | "plan" | "build" | "review" | "merge" |
    "qas" | "result", "title", "state": "pending" | "running" | "paused" | "done" | "failed" | "skipped",
    "roles": ["reader", ...], "started_ms", "ended_ms", "counts": {"events", "llm_calls", "usd", "units", "merged"}}]}

GET /api/runs/{run}/nodes/{node}/worklog?limit=200
-> {"run", "node", "entries": [{"ts", "role", "agent", "kind": "llm_call" | "decision" | "event" | "output" | "error",
    "title", "text", "cost_usd", "artifact"}]}

GET /api/runs/{run}/reports
-> {"run", "reports": [{"id", "kind": "spec" | "implement" | "test" | "qas" | "review" | "questions" | "findings" |
    "decisions" | "deploy" | "seal" | "migration", "title", "node", "created_ms", "mime", "size", "url"}]}
GET /api/runs/{run}/reports/{report}   -> {"report": {...}, "content": "<text>"}
```

Draw the nodes as the run's flow (left to right); clicking a node opens its work log (what each agent did,
including the decisions the model took when nobody answers questions) and the reports of that node.

### 5.8 Start the delivered application

When a run is `green` its result is deployed on the engine host. One button "Start app / Open app":

```
GET  /api/runs/{run}/app        -> {"run", "state": "none" | "stopped" | "starting" | "running" | "failed",
                                    "url": "http://10.0.0.12:9100/", "port", "pid", "how", "log_tail", "error"}
POST /api/runs/{run}/app:start  -> same shape; starts it (or returns it when it already runs)
POST /api/runs/{run}/app:stop   -> admin role
```

`running` -> open `url` in a new tab. `stopped` / `none` -> call `app:start`, poll `GET .../app` until `running`
(or `failed`: show `error` and `log_tail`). The address uses the host name and the port range the operator
configured, so it opens from users' browsers.

### 5.9 Feature migration (v1 -> v2)

UI: two repository paths on the engine host (v1 may be a folder holding many repositories), mode
`ask` (people decide conflicts) or `decide` (keep v2 automatically, with a backup and a log), optional
notes file path and budget caps.

```
POST /api/migrations
{"v1": "D:\\legacy\\v17", "v2": "D:\\work\\product-v2", "mode": "ask", "build": true,
 "max_usd": 50, "max_usd_repo": 3}
-> 202 {"migration": "M20261011-190229-bbf8", "state": "admitted"}

GET /api/migrations/{id}
-> {"migration": {"id", "state", "code", "message", "mode", "counts": {"matrix": {...}}, "budget": {"limit",
    "spent", "build_spent", "remaining", "warn", "repos"}, "open_conflicts": ["C1"], "run": "<build run id>"},
    "features": [...], "conflicts": [...],
    "questions": [{"conflict": "C1", "feature": "discount rule", "text": "v1 and v2 behave differently ...",
                   "options": [{"id": "v2", "label": "keep v2: ...", "recommended": true},
                               {"id": "v1", "label": "change v2 to the v1 behaviour: ..."}]}]}

POST /api/migrations/{id}/answers
{"who": "jane@yourco.com", "answers": [{"conflict": "C1", "choice": "v2"}]}
-> 200 {"migration", "results", "remaining": 0, "resume": true}

GET /api/migrations/{id}/details   -> repos (per repository: ref, sha, stack, features, status), blast radius,
                                      effort, decisions, baseline / verify, build runs, timeline
GET /api/migrations/{id}/report    -> {"report": "<markdown>", "ready": true}
POST /api/migrations/{id}:resume {"max_usd": 80}   -> continue after raising the budget (state escalated with
                                                       code MIGRATION_BUDGET)
```

Migration states: `admitted, inventoried, matched, parked, decided, building, verifying`, then final `green`,
`analysed` (report only) or `escalated`. While a migration builds, its build is an ordinary run (`run` field):
show it with 5.4. Render the parity matrix from `features` (each has a class: `v1_only` migrate, `v2_only`
protect, `both_same` verify, `both_conflict` decide; plus a custom flag) grouped by area. A migration over many
repositories can take hours; see section 7.

### 5.10 Seal sign-off (only when the operator enabled sealing)

`GET /api/runs/{run}/seals` lists seal rows. A row waiting for a person (level L2) is signed or refused with
`POST /api/runs/{run}/seals/{subject}:sign {"who": "...", "option": "sign" | "refuse"}` (URL-encode `subject`).

## 6. Embedding the board vs building native UI

| Option | Effort | Good for |
|---|---|---|
| **Embed the board**: an `<iframe>` pointing at the engine's board (`/` for runs, `/?migration=<id>` for one migration), served through your backend's reverse proxy on a path of your app | lowest | internal tools; shows everything (lanes, units, gates, questions with answer buttons, migrations, report) |
| **Native UI** from the API (section 5) | more | your own look, your own permissions per user, your own notifications |

The board page signs the user in itself (client `dlc-fe`, the realm above); embedding it in an iframe works
when the operator lists your page's origin as an allowed web origin of `dlc-fe`.

## 7. Long-running work: polling and waiting

- A run takes minutes to hours; a migration over many repositories can take hours. Never hold an HTTP request
  open waiting for it, and never block a request thread of your backend: store the id, return to the user,
  and poll in a background job or on page view.
- Poll `GET /api/runs/{run}` every 15-30 s while someone watches the page; back off (doubling up to 5 min) when
  nobody does. Use `events?after_seq=` for a live feed instead of re-reading everything.
- Stop polling a run at `green` / `escalated`; a migration at `green` / `analysed` / `escalated`. On `parked`,
  notify the people who decide (e-mail, chat, a badge) and keep polling slowly.
- The engine resumes unfinished work after it restarts (when run with auto-resume): ids stay valid, keep
  polling.

## 8. Errors, retries, limits

| HTTP | `code` | Meaning | What to do |
|---|---|---|---|
| 401 | `UNAUTHENTICATED` | no / expired / invalid token | refresh or sign in again, retry once |
| 403 | `FORBIDDEN` | user lacks `dlc-user` (or `dlc-admin` for cancel / app stop), or the token lacks audience `dlc-api` | do not retry; ask the operator for the role |
| 400 | `SCHEMA_INVALID` | body missing a field or not JSON | fix the request; do not retry as is |
| 404 | `NOT_FOUND` | unknown run / migration, or a path not in the API | check the id / path against `/api/openapi.json` |
| 409 | `STATE_CONFLICT`, `ILLEGAL_TRANSITION`, `CANCELLED` | the run / migration is not in a state that allows this | re-read it, update the UI |
| 501 | `NOT_IMPLEMENTED` | this engine has no run driver | ask the operator |
| 500 | `INTERNAL` | engine error | retry once after a few seconds, then report time + route |
| connection refused / timeout | - | engine down or restarting | retry with backoff (1 s, 2 s, 4 s ... up to 60 s) |

Escalation codes worth showing to users: `STATE_CONFLICT` (the repository has uncommitted changes or is not on
`main`), `BUDGET_EXCEEDED` (run cap reached), `MIGRATION_BUDGET` (migration cap reached; resume with a higher
cap), `NO_PROGRESS`, `QAS_RED`, `CANCELLED`, `STACK_UNSUPPORTED`, `PARITY_REGRESSION`.

Retries: `POST /api/packs` and `POST /api/runs` are **not idempotent**; if a start request timed out, look for
the run in `GET /api/runs` (by `pack_path`) before starting again. `GET` calls are safe to retry.

Limits: spec text up to 2,000,000 characters per pack; `events` `limit` up to 5000; one JSON object per body.
Money caps are set by the operator (per run, per model call, per migration); a run that reaches its cap
escalates instead of spending more.

## 9. Integration checklist

1. Get the base URL, the sign-in settings (issuer, your client id `customer-fe`, test account) and the
   certificate file (when self-signed) from the operator; confirm the network path from your backend to the
   engine and to the issuer.
2. `GET /api/health` returns `ok: true` and `driver: true`; `GET /api/auth/config` returns `enabled: true`.
3. Implement sign-in (authorization code + PKCE, section 2) and check `GET /api/me` with the token.
4. Fetch `GET /api/openapi.json`; generate or hand-write a small client in your backend that sends the user's
   token on every call.
5. Implement 5.1 (upload -> pack -> run) and 5.4 (progress) first; then 5.6 (pause / resume), 5.7 (nodes,
   work log, reports) and 5.8 (start app); then 5.5 (questions) if your engine asks people; then 5.2 / 5.3;
   then 5.9 if you sell migrations.
6. Poll in background jobs with backoff (section 7); never block a request.
7. Map errors (section 8) to user messages.
8. Run the smoke tests below against the operator's engine and keep them in your CI as a contract check.

## 10. Smoke tests

Get a token for the test account first (with any OIDC library; the authorization-code flow needs a browser,
so let your backend's sign-in print the access token once in a test environment). The steps before the last
cost nothing. The last one starts a real run with the engine's configured model (a small spec
costs about 1-2 USD); run it once to prove the end-to-end path.

```bash
B=http://10.0.0.12:8796        # your engine base URL
T="Authorization: Bearer $ACCESS_TOKEN"

# 0. sign-in is on and the token is accepted
curl -s $B/api/auth/config               # expect: "enabled": true
curl -s -o /dev/null -w "%{http_code}\n" $B/api/runs          # expect: 401
curl -s -H "$T" $B/api/me                # expect: "actor": "demo", "roles": [... "dlc-user" ...]

# 1. alive, can start runs
curl -s $B/api/health
# expect: "ok": true ... "driver": true

# 2. contract available
curl -s $B/api/openapi.json | head -c 200
# expect: {"openapi": "3.0.3", ...

# 3. unknown paths are rejected
curl -s -o /dev/null -w "%{http_code}\n" $B/api/does-not-exist
# expect: 404

# 4. a pack can be created
curl -s -X POST $B/api/packs -H "$T" -H "Content-Type: application/json" \
  -d '{"kind": "new", "name": "smoke", "spec": "# Smoke\n\n## F1 Hello\n\n`hello NAME` prints `Hello, NAME!` and exits 0.\n"}'
# expect: 201 {"pack": "...", "kind": "new", ...}

# 5. (costs money) start it and wait
RUN=$(curl -s -X POST $B/api/runs -H "$T" -H "Content-Type: application/json" \
  -d "{\"pack\": \"<pack from step 4>\", \"project\": \"<id from POST /api/projects>\", \"flow\": \"new-system\"}" | python -c "import sys,json;print(json.load(sys.stdin)['run'])")
while true; do S=$(curl -s -H "$T" $B/api/runs/$RUN | python -c "import sys,json;print(json.load(sys.stdin)['run']['state'])"); echo $S; \
  [ "$S" = green ] || [ "$S" = escalated ] && break; sleep 30; done
# expect: green

# 6. the delivered app starts and answers
curl -s -X POST -H "$T" $B/api/runs/$RUN/app:start    # expect: "state": "running" (or "starting"), "url": ...
```

TypeScript client sketch (runs in your backend, Node 18+ `fetch`):

```ts
const BASE = process.env.DLC_URL!;   // e.g. http://10.0.0.12:8796 - never sent to browsers

// accessToken: the signed-in user's access token (your backend keeps it in the session and refreshes it)
async function dlc<T>(accessToken: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.message ?? data.error?.message ?? r.statusText),
                                 { status: r.status, code: data.code ?? data.error?.code });
  return data as T;
}

export async function startNewSystem(tok: string, project: string, name: string, specMarkdown: string) {
  const { pack } = await dlc<{ pack: string }>(tok, "POST", "/api/packs", { kind: "new", name, spec: specMarkdown });
  return dlc<{ run: string; state: string }>(tok, "POST", "/api/runs", { pack, project, flow: "new-system", name });
}

export const pause = (tok: string, run: string) => dlc(tok, "POST", `/api/runs/${encodeURIComponent(run)}:pause`, {});
export const resume = (tok: string, run: string) => dlc(tok, "POST", `/api/runs/${encodeURIComponent(run)}:resume`, {});
export const startApp = (tok: string, run: string) =>
  dlc<{ state: string; url?: string; error?: string }>(tok, "POST", `/api/runs/${encodeURIComponent(run)}/app:start`, {});

export async function pollRun(tok: () => Promise<string>, run: string, onUpdate: (detail: any) => void) {
  let delay = 15_000;
  for (;;) {
    const detail = await dlc<any>(await tok(), "GET", `/api/runs/${encodeURIComponent(run)}`);
    onUpdate(detail);
    if (["green", "escalated"].includes(detail.run.state)) return detail;
    const q = await dlc<any>(await tok(), "GET", `/api/runs/${encodeURIComponent(run)}/questions`);
    if (q.parked) onUpdate({ ...detail, questions: q.questions });
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(delay * 2, 300_000);
  }
}

export function answer(tok: string, run: string, who: string, answers: { qid: string; option: string; text?: string }[]) {
  return dlc(tok, "POST", `/api/runs/${encodeURIComponent(run)}/answers`, { who, answers });
}
```

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 401 on every call | no token, expired token, or a token from another realm | sign in again; the issuer in `/api/auth/config` must match your client's issuer exactly (scheme, host, port) |
| 403 with a valid user | role `dlc-user` missing, or token without audience `dlc-api` | operator assigns the role; the `customer-fe` client keeps its `dlc-api` audience mapper |
| sign-in page says "Cookie not found" | sign-in server reached over plain http | always use the https issuer URL |
| your backend cannot reach the issuer: certificate error | self-signed certificate not trusted | install the operator's certificate in your backend's trust store |
| "Start app" stays `failed` | the delivered app could not start on the host | show `error` / `log_tail`; ask the operator |
| connection refused | engine not running, wrong port, or firewall | operator: start `dlc serve --resume`; check `LINE_HOST` / `LINE_PORT` and the firewall rule for your backend |
| `driver: false` in health, POST answers 501 | engine started without its run driver | operator restarts the engine with `dlc serve` |
| `409 STATE_CONFLICT` when starting a run | a New System (or other non-queued flow) next to a live run, or Enhancement / Bug Fix on a project with no completed build | wait for the run (or stop it), or run New System first |
| run escalates with `QUEUE_SLOT_LOST` | its slot in the change queue was ignored: a later run was ready to build and this one was still being analysed after the wait limit (Admin > Change queue) | run it again (it joins the end of the queue), or raise the wait limit |
| run escalates with `BUDGET_EXCEEDED` | run money cap reached | ask the operator to raise `LINE_MAX_USD_RUN`, then start again |
| `POST /api/runs` 400 "pack" | missing or wrong pack path | create the pack with `POST /api/packs` and pass its `pack` value unchanged |
| browser calls fail with CORS errors | calling from the browser | call from your backend (recommended) or ask the operator to add your origin to `LINE_CORS_ORIGINS` |
| questions never appear | polling only `GET /api/runs/{run}` | also poll `GET /api/runs/{run}/questions` (or `GET /api/board?run=`) |
| migration stays `escalated` with `MIGRATION_BUDGET` | migration cap reached | `POST /api/migrations/{id}:resume {"max_usd": <higher>}` |
| 404 on a route from older notes | route not in this version | check `GET /api/openapi.json` of the installed engine |
