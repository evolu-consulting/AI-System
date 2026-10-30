// dlc-dify · pha sau của quy trình DLC: P3 build theo queue (tuần tự), P4 nghiệm thu + vòng sửa, P4b nghiệm thu lại,
// P5 báo cáo (lưu artifact, đóng ticket).
import { assign, code, env, http, loop, type Node, ref } from "./dsl";
import { agentCall, type ProcessSpec, PY, RULES_TOOLS, WS_HEADERS, ws } from "./process-kit";

export function buildLoop(id: string, title: string, after: string): Node {
  const s = (x: string) => `${id}_${x}`;
  return loop({
    id,
    title,
    vars: { state: "run", log: "" },
    breakOn: { var: "state", value: "empty" },
    max: 60,
    body: [
      http({
        id: s("next"),
        title: "Queue: việc kế",
        method: "post",
        url: `${env("ws_url")}/projects/${ref("spec_in", "project")}/queue/next`,
        headers: WS_HEADERS,
        timeout: [10, 300, 300],
      }),
      code({
        id: s("req"),
        title: "Domain agent · yêu cầu",
        inputs: {
          nxt: [s("next"), "body"],
          project: ["spec_in", "project"],
          cmd: ["design", "test_command"],
          plan_text: ["design", "plan_text"],
          spawned: [after, "body"],
        },
        outputs: ["body", "task_id", "skip"],
        code: `${PY}
def main(nxt: str, project: str, cmd: str, plan_text: str, spawned: str) -> dict:
    item = resp(nxt).get("item")
    if not item:
        return {"body": call_body("", "", True), "task_id": "", "skip": "1"}
    keys = [a.get("key") for a in (resp(spawned).get("agents") or [])]
    agent = "dlc-" + project + "-" + item.get("domain", "")
    agent = re.sub(r"[^a-z0-9-]+", "-", agent)[:48].rstrip("-")
    if agent not in keys:
        agent = keys[0] if keys else "dlc-build"
    notes = "\\n".join(item.get("notes") or [])
    prompt = ("DLC build. Project \`" + project + "\`. Your branch: \`" + item.get("branch", "") + "\` (made from main; it already holds the approved automated tests).\\n${RULES_TOOLS}\\n\\n"
        "Task " + item["id"] + ": " + item.get("title", "") + " (domain " + item.get("domain", "") + ")\\n\\n## Detail\\n" + item.get("detail", "") + "\\n\\n## Acceptance\\n" + item.get("acceptance", "") + "\\n\\n"
        "Implement ONLY this task on your branch: read the existing code (dlc-ws-files), write the code (dlc-ws-write), run \`" + (cmd or "npm test") + "\` on your branch with dlc-ws-exec and iterate until the tests for this task pass and no earlier passing test breaks. "
        "Merge gate: after merging your branch into main the suite must pass in full, OR have no more failing and no fewer passing tests than main before the merge; tests of LATER tasks may still fail, do not implement later tasks early. If main already does everything this task asks, change nothing and say so. "
        "Install dependencies through the project files (package.json) so the test command works from a clean checkout. Do not weaken or delete tests; fix a test only for a real defect and say so. Commit with dlc-ws-commit. "
        "Answer status done with a short summary and \`\`\`json {\\"done\\": true, \\"summary\\": \\"...\\"}\`\`\`.\\n"
        + (("\\n## PREVIOUS ATTEMPTS FAILED - fix this first\\n" + notes[-6000:] + "\\n") if notes else "")
        + "\\n## Approved plan (context)\\n" + clip(plan_text, 15000))
    return {"body": call_body(agent, prompt), "task_id": item["id"], "skip": ""}
`,
      }),
      agentCall(s("call"), "Domain agent · làm task (nhánh riêng)", [s("req"), "body"]),
      code({
        id: s("int_req"),
        title: "Integrate · yêu cầu",
        inputs: { task_id: [s("req"), "task_id"], skip: [s("req"), "skip"] },
        outputs: ["body"],
        code: `${PY}
def main(task_id: str, skip: str) -> dict:
    return {"body": json.dumps({"task_id": task_id, "skip": bool(skip)})}
`,
      }),
      ws(
        s("integrate"),
        "Merge tuần tự vào main + chạy test",
        "post",
        `/projects/${ref("spec_in", "project")}/integrate`,
        [s("int_req"), "body"],
      ),
      code({
        id: s("out"),
        title: "Kết quả vòng",
        inputs: {
          skip: [s("req"), "skip"],
          task_id: [s("req"), "task_id"],
          call: [s("call"), "body"],
          integ: [s("integrate"), "body"],
          log: [id, "log"],
        },
        outputs: ["state", "log"],
        code: `${PY}
def main(skip: str, task_id: str, call: str, integ: str, log: str) -> dict:
    if skip:
        return {"state": "empty", "log": log or ""}
    c = resp(call)
    i = resp(integ)
    item = i.get("item") or {}
    line = "- " + task_id + ": agent=" + str(c.get("status")) + ", merged=" + str(i.get("merged")) + ", tests=" + ("PASS" if i.get("ok") else "FAIL") + " -> " + str(item.get("status")) + " (attempt " + str(item.get("attempts", 0)) + ")"
    return {"state": "run", "log": (log or "") + line + "\\n"}
`,
      }),
      assign(s("set"), id, { state: [s("out"), "state"], log: [s("out"), "log"] }),
    ],
  });
}

/** P4 · nghiệm thu 100% spec; thiếu ⇒ việc sửa vào queue. */
export function verifyPhase(p: ProcessSpec): Node[] {
  return [
    code({
      id: "verify_req",
      title: "Nghiệm thu · yêu cầu",
      inputs: {
        spec: ["spec_in", "spec"],
        project: ["spec_in", "project"],
        cmd: ["design", "test_command"],
        plan_text: ["design", "plan_text"],
        log: ["build", "log"],
      },
      outputs: ["body"],
      code: `${PY}
def main(spec: str, project: str, cmd: str, plan_text: str, log: str) -> dict:
    prompt = ("DLC ${p.title} - VERIFY step. Project \`" + project + "\`, branch main (all tasks merged).\\n${RULES_TOOLS}\\n\\n"
        "Check the product against the spec item by item (target 100%): run \`" + (cmd or "npm test") + "\` on main with dlc-ws-exec, read the code, and map EVERY spec item / acceptance point to evidence (test name + result, or file). "
        "Save the report with dlc-ws-artifact (name verification). Answer status done with the report and ONE \`\`\`json block: "
        '{"coverage": <0-100>, "tests_pass": true|false, "gaps": [{"id": "fix1", "title": "...", "domain": "...", "detail": "...", "acceptance": "..."}]} '
        "- gaps = every missing/incorrect behaviour or failing test, as fix tasks for the dev agents (empty list when 100%).\\n\\n"
        "## Build log\\n" + clip(log, 8000) + "\\n\\n## Approved plan\\n" + clip(plan_text, 20000) + "\\n\\n## Spec\\n" + clip(spec, 60000))
    return {"body": call_body("dlc-verify", prompt)}
`,
    }),
    agentCall("verify_call", "dlc-verify · đối chiếu 100% spec", ["verify_req", "body"]),
    code({
      id: "verify_out",
      title: "Nghiệm thu · việc sửa",
      inputs: { raw: ["verify_call", "body"], tag: ["prep", "run_tag"] },
      outputs: ["queue_body", "report", "coverage"],
      code: `${PY}
def main(raw: str, tag: str) -> dict:
    r = resp(raw)
    v = block(r.get("text") or "")
    gaps = v.get("gaps") or []
    items = [{"id": tag + "-" + str(g.get("id") or ("fix" + str(i + 1)))[:30], "title": str(g.get("title") or "fix")[:300], "domain": str(g.get("domain") or ""),
              "detail": str(g.get("detail") or "")[:20000], "acceptance": str(g.get("acceptance") or "")[:20000], "source": "verify"} for i, g in enumerate(gaps)]
    return {"queue_body": json.dumps({"items": items}), "report": clip(r.get("text") or "", 40000), "coverage": str(v.get("coverage", "?"))}
`,
    }),
    http({
      id: "ws_fix",
      title: "Queue: việc sửa từ nghiệm thu",
      method: "post",
      url: `${env("ws_url")}/projects/${ref("spec_in", "project")}/queue`,
      headers: WS_HEADERS,
      jsonBody: ["verify_out", "queue_body"],
      timeout: [10, 60, 60],
    }),
  ];
}

/** P4b · nghiệm thu lại SAU vòng sửa (chỉ khi vòng sửa có làm việc) — báo cáo cuối dùng kết quả mới nhất, không dùng
 *  kết quả trước khi sửa. Không tạo thêm việc sửa (đã hết vòng): khoảng trống còn lại nằm trong báo cáo cho người. */
export function finalVerifyPhase(p: ProcessSpec): Node[] {
  return [
    code({
      id: "verify2_req",
      title: "Nghiệm thu lại · yêu cầu",
      inputs: {
        spec: ["spec_in", "spec"],
        project: ["spec_in", "project"],
        cmd: ["design", "test_command"],
        log: ["fix", "log"],
        prev: ["verify_out", "report"],
      },
      outputs: ["body"],
      code: `${PY}
def main(spec: str, project: str, cmd: str, log: str, prev: str) -> dict:
    if not (log or "").strip():
        return {"body": call_body("", "", True)}
    prompt = ("DLC ${p.title} - FINAL VERIFY after the fix round. Project \`" + project + "\`, branch main.\\n${RULES_TOOLS}\\n\\n"
        "The previous verification found gaps; fix tasks were built and merged (log below). Check again item by item: run \`" + (cmd or "npm test") + "\` on main with dlc-ws-exec, "
        "read the code, and map EVERY spec item / acceptance point to evidence. Save the report with dlc-ws-artifact (name verification). "
        "Answer status done with the report and ONE \`\`\`json block: "
        '{"coverage": <0-100>, "tests_pass": true|false, "gaps": [{"id": "...", "title": "...", "detail": "..."}]} '
        "(gaps that remain are reported to the person; no further fix round).\\n\\n"
        "## Fix round log\\n" + clip(log, 8000) + "\\n\\n## Previous verification\\n" + clip(prev, 15000) + "\\n\\n## Spec\\n" + clip(spec, 60000))
    return {"body": call_body("dlc-verify", prompt)}
`,
    }),
    agentCall("verify2_call", "dlc-verify · nghiệm thu lại", ["verify2_req", "body"]),
    code({
      id: "verify2_out",
      title: "Nghiệm thu cuối",
      inputs: {
        raw: ["verify2_call", "body"],
        prev: ["verify_out", "report"],
        prev_cov: ["verify_out", "coverage"],
      },
      outputs: ["report", "coverage"],
      code: `${PY}
def main(raw: str, prev: str, prev_cov: str) -> dict:
    r = resp(raw)
    if r.get("status") != "done":
        return {"report": prev or "", "coverage": prev_cov or "?"}
    v = block(r.get("text") or "")
    return {"report": "### Final verification (after the fix round)\\n" + clip(r.get("text") or "", 40000), "coverage": str(v.get("coverage", "?"))}
`,
    }),
  ];
}

export function reportPhase(p: ProcessSpec): Node[] {
  return [
    ws("ws_final", "Workspace: trạng thái cuối", "get", `/projects/${ref("spec_in", "project")}`),
    code({
      id: "report",
      title: "Báo cáo",
      inputs: {
        proj: ["ws_final", "body"],
        plan_text: ["design", "plan_text"],
        log1: ["build", "log"],
        log2: ["fix", "log"],
        verify: ["verify2_out", "report"],
        coverage: ["verify2_out", "coverage"],
        project: ["spec_in", "project"],
      },
      outputs: ["text", "artifact_body", "ticket_body"],
      code: `${PY}
def main(proj: str, plan_text: str, log1: str, log2: str, verify: str, coverage: str, project: str) -> dict:
    p = resp(proj)
    q = p.get("queue") or []
    rows = "\\n".join("| " + x.get("id", "") + " | " + x.get("title", "")[:60] + " | " + x.get("domain", "") + " | " + x.get("status", "") + " | " + str(x.get("attempts", 0)) + " |" for x in q)
    s = p.get("summary") or {}
    text = ("# DLC ${p.title} - project " + project + "\\n\\n"
        + "**Queue:** " + str(s.get("ready_to_deploy", 0)) + " ready to deploy, " + str(s.get("failed", 0)) + " failed, " + str(s.get("queued", 0)) + " still queued (of " + str(s.get("total", 0)) + "). "
        + "**Spec coverage (verify):** " + coverage + "%. Deploy is done by a person; items marked ready_to_deploy are merged on main with tests passing.\\n\\n"
        + "| task | title | domain | status | attempts |\\n|---|---|---|---|---|\\n" + rows + "\\n\\n"
        + "## Build log\\n" + (log1 or "") + (log2 or "") + "\\n\\n## Verification\\n" + clip(verify, 20000) + "\\n\\n## Git (main)\\n\`\`\`\\n" + (p.get("log") or "") + "\\n\`\`\`\\n\\n<details><summary>Approved plan</summary>\\n\\n" + clip(plan_text, 20000) + "\\n</details>")
    return {"text": clip(text, 150000), "artifact_body": json.dumps({"content": text}),
            "ticket_body": json.dumps({"status": "done", "project_key": project})}
`,
    }),
    http({
      id: "ws_report",
      title: "Workspace: lưu báo cáo",
      method: "put",
      url: `${env("ws_url")}/projects/${ref("spec_in", "project")}/artifacts/result`,
      headers: WS_HEADERS,
      jsonBody: ["report", "artifact_body"],
      timeout: [10, 120, 120],
    }),
    // Ticket Trello (nếu có) → done: code đã merge và chờ người deploy trong queue.
    http({
      id: "ws_ticket_done",
      title: "Ticket: xong (chờ deploy)",
      method: "patch",
      url: `${env("ws_url")}${ref("prep", "ticket_path")}`,
      headers: WS_HEADERS,
      jsonBody: ["report", "ticket_body"],
      timeout: [10, 60, 60],
    }),
  ];
}
