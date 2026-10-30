// dlc-dify · tool vận hành + tri thức:
//   dlc-agent: dlc-deploys (việc chờ deploy + lịch sử), dlc-deploy (người chọn ⇒ build + chạy app của project trên máy chủ);
//   agent làm code (dlc-spec, dlc-qc, dlc-build + domain agent, dlc-verify): dlc-kh-search (tra tri thức nghiệp vụ / cấu trúc
//   của project trong KnowledgeHub theo quyền của user đang chat).
import { code, env, http, ref } from "./dsl";
import { fmt, P, PROJECT, T, type ToolEnv, type ToolFlow, tool, WS } from "./tool-kit";

function deploys(e: ToolEnv): ToolFlow {
  return tool(
    e,
    "dlc-deploys",
    "DLC · việc chờ deploy",
    "Xem các việc ready_to_deploy (đã merge + test xanh, chưa deploy) của một project DLC, địa chỉ app và lịch sử deploy gần nhất.",
    [PROJECT],
    [
      http({
        id: "get",
        title: "Workspace: deploys",
        method: "get",
        url: `${env("ws_url")}/projects/${ref("start", "project")}/deploys`,
        headers: WS,
        timeout: [10, 60, 60],
      }),
      fmt(
        { raw: ["get", "body"], status: ["get", "status_code"] },
        `def main(raw: str, status) -> dict:
    r = resp(raw)
    if str(status) != "200":
        return {"text": "ERROR " + str(status) + ": " + str(r.get("error") or raw)[:300]}
    ready = "\\n".join("- " + x.get("id", "") + " (" + str(x.get("sha")) + ") " + x.get("title", "") for x in r.get("ready") or []) or "(none)"
    hist = "\\n".join("- " + d.get("at", "") + " " + d.get("sha", "") + (" ok" if d.get("ok") else " FAILED") + " tasks: " + ", ".join(d.get("tasks") or []) for d in r.get("deploys") or []) or "(never deployed)"
    return {"text": "deploy configured: " + str(r.get("configured")) + "\\napp url: " + str(r.get("url")) + "\\nready_to_deploy:\\n" + ready + "\\nhistory:\\n" + hist}
`,
      ),
    ],
  );
}

function deploy(e: ToolEnv): ToolFlow {
  return tool(
    e,
    "dlc-deploy",
    "DLC · deploy",
    "Deploy app của project DLC lên máy chủ: build + chạy lại app. `task_ids` (id việc, cách nhau dấu phẩy) = chỉ deploy tới các việc đó (main tuần tự nên kéo theo việc merge trước); để trống = deploy toàn bộ main. CHỈ gọi khi người dùng yêu cầu deploy rõ ràng.",
    [PROJECT, T("task_ids", "Id việc cần deploy (phẩy), trống = tất cả")],
    [
      code({
        id: "body",
        title: "Body",
        inputs: { ids: ["start", "task_ids"] },
        outputs: ["body"],
        code: `import json
def main(ids: str) -> dict:
    t = [x.strip() for x in (ids or "").replace(";", ",").split(",") if x.strip()]
    return {"body": json.dumps({"task_ids": t} if t else {})}
`,
      }),
      http({
        id: "post",
        title: "Workspace: deploy",
        method: "post",
        url: `${env("ws_url")}/projects/${ref("start", "project")}/deploy`,
        headers: WS,
        jsonBody: ["body", "body"],
        timeout: [30, 1900, 1900],
      }),
      fmt(
        { raw: ["post", "body"], status: ["post", "status_code"] },
        `def main(raw: str, status) -> dict:
    r = resp(raw)
    if str(status) != "200":
        return {"text": "deploy refused (HTTP " + str(status) + "): " + str(r.get("error") or raw)[:500]}
    head = ("DEPLOYED " if r.get("ok") else "DEPLOY FAILED ") + str(r.get("sha")) + " at " + str(r.get("url"))
    return {"text": head + "\\ntasks deployed: " + (", ".join(r.get("tasks") or []) or "(none, main only)") + "\\n\\n" + str(r.get("output") or "")[-2500:]}
`,
      ),
    ],
  );
}

function khSearch(e: ToolEnv): ToolFlow {
  return tool(
    e,
    "dlc-kh-search",
    "DLC · tra tri thức project (KH)",
    "Tra KnowledgeHub của project DLC: nghiệp vụ, luật, quyết định cũ, cấu trúc app, cách chạy/test. Hỏi bằng câu tiếng Anh ngắn, cụ thể. Trả các mục tri thức gần nhất (id + nội dung).",
    [PROJECT, P("query", "Câu hỏi (tiếng Anh)", true), T("user_token", "Token user (Hub tự điền)")],
    [
      code({
        id: "body",
        title: "Body",
        inputs: { project: ["start", "project"], q: ["start", "query"] },
        outputs: ["body"],
        code: `import json
def main(project: str, q: str) -> dict:
    return {"body": json.dumps({"text": " ".join((q or "").split())[:3900] or "overview", "project": project, "budget_chars": 9000})}
`,
      }),
      http({
        id: "post",
        title: "KH: context/step",
        method: "post",
        url: `${env("kh_url")}/context/step`,
        headers: [
          `Authorization:Bearer ${ref("start", "user_token")}`,
          "Content-Type:application/json",
        ],
        jsonBody: ["body", "body"],
        timeout: [10, 90, 90],
      }),
      fmt(
        { raw: ["post", "body"], status: ["post", "status_code"] },
        `def main(raw: str, status) -> dict:
    r = resp(raw)
    if str(status) != "200":
        return {"text": "KH error " + str(status) + ": " + str(r.get("detail") or r.get("error") or raw)[:300]}
    items = [i for i in (r.get("items") or []) if i.get("tier") != "log-recent"]
    if not items:
        return {"text": "no knowledge found for this question in project " + str(r.get("project"))}
    return {"text": "\\n\\n".join("[" + str(i.get("id")) + "] " + str(i.get("text") or "") for i in items)[:9000]}
`,
      ),
    ],
  );
}

export function opsToolFlows(e: ToolEnv): ToolFlow[] {
  return [deploys(e), deploy(e), khSearch(e)];
}
