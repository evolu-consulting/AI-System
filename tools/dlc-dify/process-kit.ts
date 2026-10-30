// dlc-dify · bộ dựng chung của flow quy trình DLC: kiểu quy trình, tiện ích Python của node code, header Hub/workspace,
// node gọi agent qua Hub (`agentCall`) và gọi workspace (`ws`), luật dùng tool workspace cho agent.
import { env, http, ref } from "./dsl";

export type ProcessSpec = {
  key: string;
  name: string;
  mode: "new-system" | "enhancement" | "bug-fix";
  title: string;
  toolDescription: string;
};

export const PY = `import json, re
def block(text):
    for s in reversed(re.findall(r"\`\`\`json\\s*(.*?)\`\`\`", text or "", re.S)):
        try:
            return json.loads(s)
        except Exception:
            pass
    try:
        return json.loads(text or "")
    except Exception:
        return {}
def call_body(agent, prompt, skip=False):
    return json.dumps({"agent_key": agent if not skip else "", "prompt": prompt, "skip": bool(skip), "wait_s": 86400})
def resp(raw):
    try:
        return json.loads(raw or "{}")
    except Exception:
        return {}
def clip(s, n):
    s = s or ""
    return s if len(s) <= n else s[:n] + "\\n...(truncated)"
`;

export const HUB_HEADERS = [
  `Authorization:Bearer ${ref("start", "hub_ticket")}`,
  "Content-Type:application/json",
];
export const WS_HEADERS = [
  `Authorization:Bearer ${env("ws_token")}`,
  "Content-Type:application/json",
];
export const LONG: [number, number, number] = [60, 86_400, 86_400];

export const agentCall = (id: string, title: string, body: [string, string]) =>
  http({
    id,
    title,
    method: "post",
    url: `${env("hub_url")}/dify/agent-calls`,
    headers: HUB_HEADERS,
    jsonBody: body,
    timeout: LONG,
  });
export const ws = (
  id: string,
  title: string,
  method: "get" | "post" | "put" | "patch",
  path: string,
  body?: [string, string],
) =>
  http({
    id,
    title,
    method,
    url: `${env("ws_url")}${path}`,
    headers: WS_HEADERS,
    ...(body ? { jsonBody: body } : {}),
    timeout: [30, 3600, 3600],
  });

export const RULES_TOOLS =
  "Workspace tools (MCP): dlc-ws-files (list/read), dlc-ws-write (write a file), dlc-ws-exec (run a shell command in a Linux container with Node 22 + npm + python3, cwd = repo root of the branch), dlc-ws-commit, dlc-ws-artifact (save a markdown artifact under docs/dlc/). Always pass `project` and `branch`.";

/** P0 · khởi tạo: spec từ file + chữ + ticket, gắn hội thoại, lưu artifact. */
