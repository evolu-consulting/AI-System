// dlc-dify · tool workspace DLC cho agent làm code (dlc-spec, dlc-qc, dlc-build + domain agent, dlc-verify):
// dlc-ws-files / -write / -exec / -commit / -artifact (repo git của project, chạy lệnh trong container).
import { code, env, http, ref } from "./dsl";
import { BRANCH, fmt, P, PROJECT, T, type ToolEnv, type ToolFlow, tool, WS } from "./tool-kit";

export function wsToolFlows(e: ToolEnv): ToolFlow[] {
  return [
    tool(
      e,
      "dlc-ws-files",
      "DLC · đọc file workspace",
      "Liệt kê thư mục hoặc đọc MỘT file trong repo của project DLC trên một nhánh. `path` rỗng = gốc repo. Trả danh sách file hoặc nội dung.",
      [PROJECT, BRANCH, T("path", "Đường dẫn file/thư mục (tương đối gốc repo)")],
      [
        http({
          id: "get",
          title: "Workspace: files",
          method: "get",
          url: `${env("ws_url")}/projects/${ref("start", "project")}/files`,
          headers: WS,
          params: [`branch:${ref("start", "branch")}`, `path:${ref("start", "path")}`],
          timeout: [10, 120, 120],
        }),
        fmt(
          { raw: ["get", "body"], status: ["get", "status_code"] },
          `def main(raw: str, status) -> dict:
    r = resp(raw)
    if str(status) != "200":
        return {"text": "ERROR " + str(status) + ": " + str(r.get("error") or raw)[:500]}
    if not r.get("exists"):
        return {"text": "(not found)"}
    if r.get("type") == "dir":
        return {"text": "\\n".join(r.get("files") or []) or "(empty)"}
    return {"text": (r.get("content") or "") + ("\\n...(truncated)" if r.get("truncated") else "")}
`,
        ),
      ],
    ),
    tool(
      e,
      "dlc-ws-write",
      "DLC · ghi file workspace",
      "Ghi (tạo/đè) MỘT file trong repo của project DLC trên một nhánh. Truyền toàn bộ nội dung file trong `content`.",
      [PROJECT, BRANCH, T("path", "Đường dẫn file", true), P("content", "Nội dung file", true)],
      [
        code({
          id: "body",
          title: "Body",
          inputs: {
            branch: ["start", "branch"],
            path: ["start", "path"],
            content: ["start", "content"],
          },
          outputs: ["body"],
          code: `import json
def main(branch: str, path: str, content: str) -> dict:
    return {"body": json.dumps({"branch": branch or "main", "path": path, "content": content or ""})}
`,
        }),
        http({
          id: "put",
          title: "Workspace: write",
          method: "put",
          url: `${env("ws_url")}/projects/${ref("start", "project")}/files`,
          headers: WS,
          jsonBody: ["body", "body"],
          timeout: [10, 120, 120],
        }),
        fmt(
          { raw: ["put", "body"], status: ["put", "status_code"] },
          `def main(raw: str, status) -> dict:
    r = resp(raw)
    return {"text": ("wrote " + str(r.get("path")) + " (" + str(r.get("bytes")) + " bytes)") if str(status) == "200" else "ERROR " + str(status) + ": " + str(r.get("error") or raw)[:500]}
`,
        ),
      ],
    ),
    tool(
      e,
      "dlc-ws-exec",
      "DLC · chạy lệnh workspace",
      "Chạy MỘT lệnh shell (bash) ở gốc repo của nhánh, trong container Linux có Node 22, npm, python3 (vd `npm install && npm test`). Trả exit code + output.",
      [
        PROJECT,
        BRANCH,
        P("command", "Lệnh bash", true),
        T("timeout_s", "Hạn (giây, mặc định 600)"),
      ],
      [
        code({
          id: "body",
          title: "Body",
          inputs: {
            branch: ["start", "branch"],
            command: ["start", "command"],
            timeout_s: ["start", "timeout_s"],
          },
          outputs: ["body"],
          code: `import json
def main(branch: str, command: str, timeout_s: str) -> dict:
    try:
        t = max(5, min(1800, int(timeout_s or 600)))
    except Exception:
        t = 600
    return {"body": json.dumps({"branch": branch or "main", "command": command or "", "timeout_s": t})}
`,
        }),
        http({
          id: "run",
          title: "Workspace: exec",
          method: "post",
          url: `${env("ws_url")}/projects/${ref("start", "project")}/exec`,
          headers: WS,
          jsonBody: ["body", "body"],
          timeout: [10, 1900, 1900],
        }),
        fmt(
          { raw: ["run", "body"], status: ["run", "status_code"] },
          `def main(raw: str, status) -> dict:
    r = resp(raw)
    if str(status) != "200":
        return {"text": "ERROR " + str(status) + ": " + str(r.get("error") or raw)[:500]}
    return {"text": "exit_code=" + str(r.get("exit_code")) + (" (TIMED OUT)" if r.get("timed_out") else "") + " ms=" + str(r.get("ms")) + "\\n" + (r.get("output") or "")}
`,
        ),
      ],
    ),
    tool(
      e,
      "dlc-ws-commit",
      "DLC · commit workspace",
      "Commit mọi thay đổi của nhánh trong repo project DLC với `message`.",
      [PROJECT, BRANCH, T("message", "Commit message", true)],
      [
        code({
          id: "body",
          title: "Body",
          inputs: { branch: ["start", "branch"], message: ["start", "message"] },
          outputs: ["body"],
          code: `import json
def main(branch: str, message: str) -> dict:
    return {"body": json.dumps({"branch": branch or "main", "message": message or "update"})}
`,
        }),
        http({
          id: "post",
          title: "Workspace: commit",
          method: "post",
          url: `${env("ws_url")}/projects/${ref("start", "project")}/commit`,
          headers: WS,
          jsonBody: ["body", "body"],
          timeout: [10, 120, 120],
        }),
        fmt(
          { raw: ["post", "body"] },
          `def main(raw: str) -> dict:
    r = resp(raw)
    return {"text": ("committed " + str(r.get("sha"))) if r.get("committed") else ("nothing to commit (HEAD " + str(r.get("sha")) + ")")}
`,
        ),
      ],
    ),
    tool(
      e,
      "dlc-ws-artifact",
      "DLC · lưu tài liệu",
      "Lưu MỘT tài liệu markdown của quy trình (spec, plan, test-plan, verification…) vào `docs/dlc/<name>.md` trên main và commit.",
      [
        PROJECT,
        T("name", "Tên (vd plan, test-plan)", true),
        P("content", "Nội dung markdown", true),
      ],
      [
        code({
          id: "body",
          title: "Body",
          inputs: { content: ["start", "content"] },
          outputs: ["body"],
          code: `import json
def main(content: str) -> dict:
    return {"body": json.dumps({"content": content or ""})}
`,
        }),
        http({
          id: "put",
          title: "Workspace: artifact",
          method: "put",
          url: `${env("ws_url")}/projects/${ref("start", "project")}/artifacts/${ref("start", "name")}`,
          headers: WS,
          jsonBody: ["body", "body"],
          timeout: [10, 120, 120],
        }),
        fmt(
          { raw: ["put", "body"] },
          `def main(raw: str) -> dict:
    r = resp(raw)
    return {"text": "saved " + str(r.get("path")) + " (" + str(r.get("sha")) + ")"}
`,
        ),
      ],
    ),
  ];
}
