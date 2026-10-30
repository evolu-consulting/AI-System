// dlc-dify · pha đầu của quy trình DLC: P0 khởi tạo (project, ticket, spec đầu vào), P1 thiết kế (spec ⇄ QC, xin duyệt,
// Loop), P2 chuẩn bị đội (sinh domain/QC agent) + đưa việc vào queue.
import { assign, code, env, http, loop, type Node, ref } from "./dsl";
import {
  agentCall,
  HUB_HEADERS,
  type ProcessSpec,
  PY,
  RULES_TOOLS,
  WS_HEADERS,
  ws,
} from "./process-kit";

export function initPhase(p: ProcessSpec): Node[] {
  return [
    code({
      id: "prep",
      title: "Chuẩn bị",
      inputs: {
        project: ["start", "project"],
        conv: ["start", "hub_conversation_id"],
        ticket_id: ["start", "ticket_id"],
      },
      outputs: ["project_body", "ticket_path", "ticket_body", "key", "run_tag"],
      code: `${PY}
import time
def main(project: str, conv: str, ticket_id: str) -> dict:
    key = re.sub(r"[^a-z0-9-]+", "-", (project or "").lower()).strip("-")[:48] or "project"
    tid = (ticket_id or "").strip()
    n, b36 = int(time.time()), ""
    while n:
        n, r = divmod(n, 36)
        b36 = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + b36
    # Nhãn lượt chạy: id việc trong queue (một queue / project) không trùng giữa các lượt và các quy trình.
    tag = "${p.mode === "new-system" ? "ns" : p.mode === "enhancement" ? "en" : "bf"}" + b36[-5:]
    return {"run_tag": tag, "key": key, "project_body": json.dumps({"key": key, "title": project or key, "conversation_id": conv or None, "kh_project": key}),
            "ticket_path": "/tickets/" + (tid or "none"),
            "ticket_body": json.dumps({"status": "taken", "project_key": key})}
`,
    }),
    ws("ws_project", "Workspace: project + gắn hội thoại", "post", "/projects", [
      "prep",
      "project_body",
    ]),
    http({
      id: "ticket",
      title: "Ticket Trello",
      method: "get",
      url: `${env("ws_url")}${ref("prep", "ticket_path")}`,
      headers: WS_HEADERS,
      timeout: [10, 60, 60],
    }),
    http({
      id: "spec_files",
      title: "Workspace: file spec đã lưu",
      method: "get",
      url: `${env("ws_url")}/projects/${ref("prep", "key")}/spec-files`,
      headers: WS_HEADERS,
      timeout: [10, 60, 60],
    }),
    code({
      id: "spec_in",
      title: "Gộp spec đầu vào",
      inputs: {
        requirement: ["start", "requirement"],
        files: ["spec_files", "body"],
        ticket: ["ticket", "body"],
        ticket_status: ["ticket", "status_code"],
        ws_project: ["ws_project", "body"],
      },
      outputs: ["spec", "project", "artifact_body", "has_ticket"],
      code: `${PY}
def main(requirement: str, files: str, ticket: str, ticket_status, ws_project: str) -> dict:
    parts = []
    t = resp(ticket) if str(ticket_status) == "200" else {}
    if t.get("id"):
        parts.append("## Trello ticket " + t.get("id", "") + " (" + t.get("kind", "") + "): " + t.get("name", "") + "\\n" + (t.get("url") or "") + "\\n\\n" + (t.get("desc") or ""))
    # New System: spec = các file người dùng đã lưu (dlc-spec-upload). Enhancement / Bug Fix: chỉ ticket + lời user.
    if "${p.mode}" == "new-system":
        s = str(resp(files).get("text") or "").strip()
        if s:
            parts.append(s)
    if (requirement or "").strip():
        parts.append("## Request from the person\\n" + requirement.strip())
    spec = "\\n\\n".join(parts) or "(empty spec)"
    project = resp(ws_project).get("project") or ""
    return {"spec": clip(spec, 150000), "project": project,
            "artifact_body": json.dumps({"content": "# Spec input (${p.title})\\n\\n" + spec}),
            "has_ticket": "1" if t.get("id") else ""}
`,
    }),
    http({
      id: "ws_spec",
      title: "Workspace: lưu spec đầu vào",
      method: "put",
      url: `${env("ws_url")}/projects/${ref("spec_in", "project")}/artifacts/spec-input`,
      headers: WS_HEADERS,
      jsonBody: ["spec_in", "artifact_body"],
      timeout: [10, 120, 120],
    }),
    http({
      id: "ws_ticket",
      title: "Ticket: đã nhận",
      method: "patch",
      url: `${env("ws_url")}${ref("prep", "ticket_path")}`,
      headers: WS_HEADERS,
      jsonBody: ["prep", "ticket_body"],
      timeout: [10, 60, 60],
    }),
  ];
}

export const SPEC_TASK: Record<ProcessSpec["mode"], string> = {
  "new-system": "Design a NEW system from the spec below (empty repository).",
  enhancement:
    "Design ONE enhancement on the EXISTING system in the workspace: read the current code first (dlc-ws-files on branch main) and change only what the request needs.",
  "bug-fix":
    "Design the fix of ONE bug on the EXISTING system in the workspace: read the current code first (dlc-ws-files on branch main), find the root cause, and plan the smallest correct fix plus a regression test.",
};

/** P1 · thiết kế: spec ⇄ QC (QC trả "back" ⇒ vòng lại spec với lý do). */
export function designPhase(p: ProcessSpec): Node {
  const specBody = code({
    id: "spec_req",
    title: "Spec · yêu cầu",
    inputs: {
      spec: ["spec_in", "spec"],
      project: ["spec_in", "project"],
      feedback: ["design", "feedback"],
      plan: ["design", "plan"],
    },
    outputs: ["body"],
    code: `${PY}
def main(spec: str, project: str, feedback: str, plan: str) -> dict:
    prompt = ("DLC ${p.title} - SPEC step. Project \`" + project + "\` (workspace branch main).\\n${SPEC_TASK[p.mode]}\\n\\n"
        "${RULES_TOOLS}\\n\\n"
        "Do this in order:\\n"
        "1. Analyse the spec. If anything is unclear, missing or contradictory, ASK the person (status need_input, one focused question; give choices when useful). You may ask several times; wait for each answer.\\n"
        "2. When it is clear, write the implementation PLAN and the TEAM: domain agents (dev, one per domain, e.g. backend, frontend) and QC agents (one per domain). Present plan + team in Markdown and ask the person to APPROVE: status need_input with the whole plan + team in the text field, a SHORT question (under 300 characters) and choices [\\"Approve\\", \\"Reject\\"]. If they reject, ask what to correct, fix it and ask again.\\n"
        "3. Only after approval: save the plan with dlc-ws-artifact (name plan), then answer status done with the plan and ONE \`\`\`json block:\\n"
        '{"approved": true, "stack": "...", "test_command": "<one command that runs the whole automated test suite from the repo root, non-interactive>", '
        '"tasks": [{"id": "t1", "title": "...", "domain": "backend", "detail": "...", "acceptance": "..."}], '
        '"domains": [{"domain": "backend", "name": "...", "focus": "..."}], "qc": [{"domain": "backend", "name": "...", "focus": "..."}]}\\n'
        "Rules: the stack must run in Node 22 / npm / python3 on Linux; small tasks in build order (each builds on the earlier ones); every spec item maps to at least one task; task.domain is one of domains.\\n\\n"
        + (("## QC SENT THE SPEC BACK - fix this, then ask for approval again\\n" + feedback + "\\n\\n## Previous plan\\n" + clip(plan, 20000) + "\\n\\n") if (feedback or "").strip() else "")
        + "## Spec\\n" + spec)
    return {"body": call_body("dlc-spec", prompt)}
`,
  });
  const specParse = code({
    id: "spec_out",
    title: "Spec · kết quả",
    inputs: { raw: ["spec_call", "body"] },
    outputs: ["plan", "plan_text", "status", "ok"],
    code: `${PY}
def main(raw: str) -> dict:
    r = resp(raw)
    text = r.get("text") or ""
    plan = block(text)
    dialog = "\\n".join("- Q: " + clip(d.get("question"), 500) + "\\n  A: " + clip(d.get("answer"), 500) for d in (r.get("dialog") or []))
    ok = (r.get("status") == "done") and bool(plan.get("tasks"))
    err = json.dumps(r.get("error") or {})[:400]
    return {"plan": json.dumps(plan), "plan_text": clip(text, 40000) + ("\\n\\n### Decisions with the person\\n" + dialog if dialog else ""),
            "status": (r.get("status") or "failed") + ("" if ok else " " + err), "ok": "1" if ok else ""}
`,
  });
  const qcBody = code({
    id: "qc_req",
    title: "QC · yêu cầu",
    inputs: {
      spec: ["spec_in", "spec"],
      project: ["spec_in", "project"],
      plan: ["spec_out", "plan"],
      plan_text: ["spec_out", "plan_text"],
      ok: ["spec_out", "ok"],
    },
    outputs: ["body"],
    code: `${PY}
def main(spec: str, project: str, plan: str, plan_text: str, ok: str) -> dict:
    if not ok:
        return {"body": call_body("", "", True)}
    prompt = ("DLC ${p.title} - QC step. Project \`" + project + "\` (workspace branch main).\\n${RULES_TOOLS}\\n\\n"
        "Do this in order:\\n"
        "1. From the APPROVED plan and the spec, write the TEST CASES (one or more per acceptance point, id, steps, expected) and the TEST PLAN (levels, tools, how to run). Present both and ask the person to APPROVE: status need_input with the test cases + test plan in the text field, a SHORT question and choices [\\"Approve\\", \\"Reject\\"]; on reject ask what to fix and ask again.\\n"
        "2. If you find the SPEC/PLAN itself is wrong (contradiction, impossible, missing core behaviour), tell the person and ask whether to send it back to the spec step. If they agree, answer status done with \`\`\`json {\\"back\\": \\"spec\\", \\"reason\\": \\"...\\"}\`\`\` and stop.\\n"
        "3. After approval: write EXECUTABLE automated tests into the workspace (branch main) with dlc-ws-write so that the plan's test_command runs them all (create package.json / config / test runner as needed). Tests must exist for every acceptance point; they fail now because nothing is implemented yet - that is expected. Run the test command once with dlc-ws-exec to prove the suite executes, commit with dlc-ws-commit, save the test plan with dlc-ws-artifact (name test-plan).\\n"
        '4. Answer status done with a short summary and ONE \`\`\`json block: {"approved": true, "test_command": "...", "test_files": ["..."], "cases": <number>}\\n\\n'
        "## Approved plan\\n" + clip(plan_text, 40000) + "\\n\\n## Plan JSON\\n" + clip(plan, 30000) + "\\n\\n## Spec\\n" + clip(spec, 60000))
    return {"body": call_body("dlc-qc", prompt)}
`,
  });
  const qcParse = code({
    id: "qc_out",
    title: "QC · kết quả",
    inputs: {
      raw: ["qc_call", "body"],
      plan: ["spec_out", "plan"],
      ok: ["spec_out", "ok"],
      spec_status: ["spec_out", "status"],
    },
    outputs: ["state", "feedback", "qc", "test_command"],
    code: `${PY}
def main(raw: str, plan: str, ok: str, spec_status: str) -> dict:
    if not ok:
        return {"state": "retry", "feedback": "The previous SPEC attempt did not finish with an approved plan (" + spec_status + "). Start the spec step again.", "qc": "{}", "test_command": ""}
    r = resp(raw)
    if r.get("status") != "done":
        return {"state": "retry", "feedback": "The QC step did not finish (" + str(r.get("status")) + " " + json.dumps(r.get("error") or {})[:300] + "). Re-confirm the plan quickly; QC will run again.", "qc": "{}", "test_command": ""}
    q = block(r.get("text") or "")
    if q.get("back"):
        return {"state": "back", "feedback": str(q.get("reason") or "QC sent the spec back"), "qc": json.dumps(q), "test_command": ""}
    p = resp(plan)
    cmd = q.get("test_command") or p.get("test_command") or "npm test"
    return {"state": "approved", "feedback": "", "qc": json.dumps(q), "test_command": cmd}
`,
  });
  return loop({
    id: "design",
    title: "P1 · Thiết kế (spec ⇄ QC)",
    vars: { state: "start", feedback: "", plan: "{}", plan_text: "", qc: "{}", test_command: "" },
    breakOn: { var: "state", value: "approved" },
    max: 4,
    body: [
      specBody,
      agentCall("spec_call", "dlc-spec · phân tích + plan (chờ user duyệt)", ["spec_req", "body"]),
      specParse,
      qcBody,
      agentCall("qc_call", "dlc-qc · test case + test plan + script (chờ user duyệt)", [
        "qc_req",
        "body",
      ]),
      qcParse,
      assign("design_set", "design", {
        state: ["qc_out", "state"],
        feedback: ["qc_out", "feedback"],
        plan: ["spec_out", "plan"],
        plan_text: ["spec_out", "plan_text"],
        qc: ["qc_out", "qc"],
        test_command: ["qc_out", "test_command"],
      }),
    ],
  });
}

/** P2 · sinh agent domain + QC, đặt lệnh test, đưa việc vào queue. */
export function setupPhase(): Node[] {
  return [
    code({
      id: "setup",
      title: "Chuẩn bị đội + queue",
      inputs: {
        plan: ["design", "plan"],
        project: ["spec_in", "project"],
        cmd: ["design", "test_command"],
        tag: ["prep", "run_tag"],
      },
      outputs: ["dev_body", "qc_body", "settings_body", "queue_body"],
      code: `${PY}
def main(plan: str, project: str, cmd: str, tag: str) -> dict:
    p = resp(plan)
    def agents(lst):
        out = []
        for a in (lst or [])[:12]:
            d = re.sub(r"[^a-z0-9-]+", "-", str(a.get("domain") or "").lower()).strip("-")[:20]
            if d:
                out.append({"domain": d, "name": str(a.get("name") or d)[:80], "focus": str(a.get("focus") or "")[:8000]})
        return out
    dev = agents(p.get("domains")) or [{"domain": "dev", "name": "Developer", "focus": "Implements every task."}]
    qc = [{"domain": ("qc-" + a["domain"])[:24], "name": a["name"], "focus": a["focus"]} for a in agents(p.get("qc"))]
    tasks = []
    for i, t in enumerate(p.get("tasks") or []):
        d = re.sub(r"[^a-z0-9-]+", "-", str(t.get("domain") or "").lower()).strip("-")[:20]
        tasks.append({"id": tag + "-" + str(t.get("id") or ("t" + str(i + 1)))[:30], "title": str(t.get("title") or "task")[:300],
                      "domain": d if any(x["domain"] == d for x in dev) else dev[0]["domain"],
                      "detail": str(t.get("detail") or "")[:20000], "acceptance": str(t.get("acceptance") or "")[:20000], "source": "plan"})
    return {"dev_body": json.dumps({"project": project, "template": "dlc-build", "agents": dev}),
            "qc_body": json.dumps({"project": project, "template": "dlc-qc", "agents": qc}),
            "settings_body": json.dumps({"test_command": cmd or "npm test", "stack": str(p.get("stack") or "")[:200]}),
            "queue_body": json.dumps({"items": tasks})}
`,
    }),
    http({
      id: "spawn_dev",
      title: "Sinh domain agent (dev)",
      method: "post",
      url: `${env("hub_url")}/dify/agents/spawn`,
      headers: HUB_HEADERS,
      jsonBody: ["setup", "dev_body"],
      timeout: [30, 600, 600],
    }),
    http({
      id: "spawn_qc",
      title: "Sinh QC agent theo domain",
      method: "post",
      url: `${env("hub_url")}/dify/agents/spawn`,
      headers: HUB_HEADERS,
      jsonBody: ["setup", "qc_body"],
      timeout: [30, 600, 600],
    }),
    http({
      id: "ws_settings",
      title: "Workspace: lệnh test",
      method: "put",
      url: `${env("ws_url")}/projects/${ref("spec_in", "project")}/settings`,
      headers: WS_HEADERS,
      jsonBody: ["setup", "settings_body"],
      timeout: [10, 60, 60],
    }),
    http({
      id: "ws_queue",
      title: "Queue: nhận các task",
      method: "post",
      url: `${env("ws_url")}/projects/${ref("spec_in", "project")}/queue`,
      headers: WS_HEADERS,
      jsonBody: ["setup", "queue_body"],
      timeout: [10, 60, 60],
    }),
  ];
}

/** P3 / P4b · vòng build: một việc mỗi vòng, tuần tự, lỗi ⇒ về đầu queue (dev agent làm lại). */
