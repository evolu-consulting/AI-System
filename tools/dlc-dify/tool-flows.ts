// dlc-dify · tool (flow Dify) gắn cho agent qua MCP Hub:
//   agent làm code (dlc-spec, dlc-qc, dlc-build + domain agent, dlc-verify): dlc-ws-files / -write / -exec / -commit / -artifact
//     (workspace DLC: repo git của project, chạy lệnh trong container);
//   dlc-agent: dlc-project-init (project KH + workspace, gắn hội thoại), dlc-answer (chuyển lời user cho bước đang chờ),
//     dlc-waiting, dlc-tickets / dlc-ticket-read (hộp ticket Trello), dlc-project-status.
// Biến `hub_ticket`, `user_token`, `hub_conversation_id` do Hub tự điền (ẩn với model). Kết quả = biến `text`.
import { code, env, extractor, http, ref } from "./dsl";
import { fmt, HUB, P, PROJECT, T, type ToolEnv, type ToolFlow, tool, WS } from "./tool-kit";
import { wsToolFlows } from "./ws-tool-flows";

export type { ToolEnv, ToolFlow } from "./tool-kit";

export function toolFlows(e: ToolEnv): ToolFlow[] {
  return [
    ...wsToolFlows(e),
    tool(
      e,
      "dlc-spec-upload",
      "DLC · lưu file spec",
      "Lưu MỘT file spec người dùng đính kèm (pdf, md, docx…) vào project DLC (docs/dlc/spec/). Gọi một lần cho mỗi file, sau dlc-project-init và TRƯỚC dlc-new-system. Quy trình New System (kể cả khi chạy lại) đọc spec từ các file đã lưu.",
      [
        PROJECT,
        { name: "spec_file", kind: "file", label: "File spec (pdf, md…)", required: true },
        T("name", "Tên file (vd spec.md)", true),
      ],
      [
        extractor("doc", "Đọc file spec", ["start", "spec_file"]),
        code({
          id: "body",
          title: "Body",
          inputs: { name: ["start", "name"], doc: ["doc", "text"] },
          outputs: ["body"],
          code: `import json
def main(name: str, doc) -> dict:
    text = "\\n\\n".join(str(i) for i in doc if i) if isinstance(doc, list) else str(doc or "")
    return {"body": json.dumps({"name": name or "spec", "content": text})}
`,
        }),
        http({
          id: "post",
          title: "Workspace: spec file",
          method: "post",
          url: `${env("ws_url")}/projects/${ref("start", "project")}/spec-files`,
          headers: WS,
          jsonBody: ["body", "body"],
          timeout: [10, 120, 120],
        }),
        fmt(
          { raw: ["post", "body"], status: ["post", "status_code"] },
          `def main(raw: str, status) -> dict:
    r = resp(raw)
    if str(status) != "200":
        return {"text": "failed (HTTP " + str(status) + "): " + str(r.get("error") or raw)[:300]}
    return {"text": "saved " + str(r.get("path")) + " (" + str(r.get("chars")) + " characters)"}
`,
        ),
      ],
    ),
    tool(
      e,
      "dlc-project-init",
      "DLC · khởi tạo project",
      "Khởi tạo một project DLC: tạo project trong KnowledgeHub (theo tài khoản user) + repo/queue trong workspace DLC, gắn với phiên chat hiện tại. Gọi TRƯỚC khi chạy quy trình New System. Trả id project.",
      [
        T("project_id", "Id project (chữ thường, số, gạch ngang)", true),
        T("name", "Tên hiển thị"),
        P("description", "Mô tả ngắn"),
        T("user_token", "Token user (Hub tự điền)"),
        T("hub_conversation_id", "Hội thoại (Hub tự điền)"),
      ],
      [
        code({
          id: "body",
          title: "Body",
          inputs: {
            pid: ["start", "project_id"],
            name: ["start", "name"],
            desc: ["start", "description"],
            conv: ["start", "hub_conversation_id"],
          },
          outputs: ["kh", "ws", "key"],
          code: `import json, re
def main(pid: str, name: str, desc: str, conv: str) -> dict:
    key = re.sub(r"[^a-z0-9-]+", "-", (pid or "").lower()).strip("-")[:48] or "project"
    return {"key": key,
            "kh": json.dumps({"project_id": key, "name": name or key, "description": desc or ("DLC project " + key), "owner_system": "AI-System DLC"}),
            "ws": json.dumps({"key": key, "title": name or key, "conversation_id": conv or None, "kh_project": key})}
`,
        }),
        http({
          id: "kh",
          title: "KH: tạo project",
          method: "post",
          url: `${env("kh_url")}/projects`,
          headers: [
            `Authorization:Bearer ${ref("start", "user_token")}`,
            "Content-Type:application/json",
          ],
          jsonBody: ["body", "kh"],
          timeout: [10, 120, 120],
        }),
        http({
          id: "ws",
          title: "Workspace: tạo project",
          method: "post",
          url: `${env("ws_url")}/projects`,
          headers: WS,
          jsonBody: ["body", "ws"],
          timeout: [10, 120, 120],
        }),
        fmt(
          {
            key: ["body", "key"],
            kh: ["kh", "body"],
            kh_status: ["kh", "status_code"],
            ws: ["ws", "body"],
            ws_status: ["ws", "status_code"],
            conv: ["start", "hub_conversation_id"],
          },
          `def main(key: str, kh: str, kh_status, ws: str, ws_status, conv: str) -> dict:
    ok_kh = str(kh_status) in ("200", "201")
    ok_ws = str(ws_status) in ("200", "201")
    return {"text": "project=" + key + "\\nKnowledgeHub project: " + ("ok" if ok_kh else "ERROR " + str(kh_status) + " " + str(resp(kh))[:300])
        + "\\nDLC workspace: " + ("ok (bound to conversation " + (conv or "-") + ")" if ok_ws else "ERROR " + str(ws_status) + " " + str(resp(ws))[:300])}
`,
        ),
      ],
    ),
    tool(
      e,
      "dlc-answer",
      "DLC · chuyển câu trả lời",
      "Chuyển câu trả lời/quyết định của user cho bước DLC đang chờ user (spec, QC… đã hỏi trong Chat). `agent_key` = agent đang chờ (bỏ trống = bước chờ gần nhất). Dùng khi user trả lời bằng cách tag dlc-agent.",
      [
        P("answer", "Câu trả lời của user (giữ nguyên lời)", true),
        T("agent_key", "Agent đang chờ (tuỳ chọn)"),
        T("hub_ticket", "Vé (Hub tự điền)"),
      ],
      [
        code({
          id: "body",
          title: "Body",
          inputs: { answer: ["start", "answer"], agent_key: ["start", "agent_key"] },
          outputs: ["body"],
          code: `import json
def main(answer: str, agent_key: str) -> dict:
    b = {"answer": answer or ""}
    if (agent_key or "").strip():
        b["agent_key"] = agent_key.strip()
    return {"body": json.dumps(b)}
`,
        }),
        http({
          id: "post",
          title: "Hub: answers",
          method: "post",
          url: `${env("hub_url")}/dify/answers`,
          headers: HUB,
          jsonBody: ["body", "body"],
          timeout: [10, 120, 120],
        }),
        fmt(
          { raw: ["post", "body"] },
          `def main(raw: str) -> dict:
    r = resp(raw)
    if r.get("forwarded_to"):
        return {"text": "forwarded to " + r["forwarded_to"] + " (run " + str(r.get("run_id")) + ")"}
    return {"text": "no DLC step is waiting for an answer in this conversation"}
`,
        ),
      ],
    ),
    tool(
      e,
      "dlc-waiting",
      "DLC · bước đang chờ",
      "Liệt kê các bước DLC đang chờ user trả lời/duyệt trong phiên chat này (agent + câu hỏi).",
      [T("hub_ticket", "Vé (Hub tự điền)")],
      [
        http({
          id: "get",
          title: "Hub: waiting",
          method: "get",
          url: `${env("hub_url")}/dify/waiting`,
          headers: HUB,
          timeout: [10, 60, 60],
        }),
        fmt(
          { raw: ["get", "body"] },
          `def main(raw: str) -> dict:
    items = resp(raw).get("items") or []
    if not items:
        return {"text": "no DLC step is waiting"}
    return {"text": "\\n\\n".join("- " + w.get("agent_key", "") + " (since " + w.get("since", "") + "):\\n" + (w.get("question") or "")[:1500] for w in items)}
`,
        ),
      ],
    ),
    tool(
      e,
      "dlc-tickets",
      "DLC · ticket mới",
      "Liệt kê ticket Trello trong hộp DLC (cron đẩy về). `status`: new (mặc định), taken, done, hoặc rỗng = tất cả.",
      [T("status", "Trạng thái (new/taken/done)")],
      [
        http({
          id: "get",
          title: "Workspace: tickets",
          method: "get",
          url: `${env("ws_url")}/tickets`,
          headers: WS,
          params: [`status:${ref("start", "status")}`],
          timeout: [10, 60, 60],
        }),
        fmt(
          { raw: ["get", "body"] },
          `def main(raw: str) -> dict:
    items = resp(raw).get("items") or []
    if not items:
        return {"text": "no tickets"}
    return {"text": "\\n".join("- " + t.get("id", "") + " [" + t.get("kind", "") + ", " + t.get("status", "") + "] " + t.get("name", "") + (" - " + t.get("summary", "") if t.get("summary") else "") + (" (" + t.get("url", "") + ")" if t.get("url") else "") for t in items)}
`,
        ),
      ],
    ),
    tool(
      e,
      "dlc-ticket-read",
      "DLC · đọc ticket",
      "Đọc đầy đủ MỘT ticket Trello (tiêu đề, mô tả, nhãn, link) theo id ticket DLC (t-…) hoặc id thẻ Trello.",
      [T("ticket_id", "Id ticket", true)],
      [
        http({
          id: "get",
          title: "Workspace: ticket",
          method: "get",
          url: `${env("ws_url")}/tickets/${ref("start", "ticket_id")}`,
          headers: WS,
          timeout: [10, 60, 60],
        }),
        fmt(
          { raw: ["get", "body"], status: ["get", "status_code"] },
          `def main(raw: str, status) -> dict:
    t = resp(raw)
    if str(status) != "200":
        return {"text": "ticket not found"}
    return {"text": "Ticket " + t.get("id", "") + " (" + t.get("kind", "") + ", " + t.get("status", "") + ")\\nTitle: " + t.get("name", "") + "\\nLabels: " + ", ".join(t.get("labels") or []) + "\\nList: " + t.get("list", "") + "\\nURL: " + t.get("url", "") + "\\nProject: " + str(t.get("project_key")) + "\\n\\n" + (t.get("desc") or "")}
`,
        ),
      ],
    ),
    tool(
      e,
      "dlc-project-status",
      "DLC · trạng thái project",
      "Trạng thái một project DLC: queue (việc nào ready_to_deploy / failed / còn chờ), lệnh test, git log của main.",
      [PROJECT],
      [
        http({
          id: "get",
          title: "Workspace: project",
          method: "get",
          url: `${env("ws_url")}/projects/${ref("start", "project")}`,
          headers: WS,
          timeout: [10, 60, 60],
        }),
        fmt(
          { raw: ["get", "body"], status: ["get", "status_code"] },
          `def main(raw: str, status) -> dict:
    p = resp(raw)
    if str(status) != "200":
        return {"text": "project not found"}
    q = p.get("queue") or []
    rows = "\\n".join("- " + x.get("id", "") + " [" + x.get("status", "") + ", attempts " + str(x.get("attempts", 0)) + "] " + x.get("title", "") for x in q)
    return {"text": "Project " + p.get("key", "") + " - " + p.get("title", "") + "\\ntest_command: " + str(p.get("test_command")) + "\\nqueue: " + json.dumps(p.get("summary")) + "\\n" + rows + "\\n\\ngit main:\\n" + (p.get("log") or "")}
`,
        ),
      ],
    ),
  ];
}

export const WS_TOOL_KEYS = [
  "dlc-ws-files",
  "dlc-ws-write",
  "dlc-ws-exec",
  "dlc-ws-commit",
  "dlc-ws-artifact",
];
export const DLC_AGENT_TOOL_KEYS = [
  "dlc-spec-upload",
  "dlc-project-init",
  "dlc-answer",
  "dlc-waiting",
  "dlc-tickets",
  "dlc-ticket-read",
  "dlc-project-status",
];
