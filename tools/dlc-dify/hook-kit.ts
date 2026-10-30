// dlc-dify · bộ dựng chung cho flow hook (Claude CLI hook → Dify): biến start, header KnowledgeHub (RU/TU/actor), node gọi KH,
// tiện ích Python `ok`, khung app một hook.
import { type AppSpec, app, env, http, ref, type StartVar } from "./dsl";

export type HookFlow = {
  key: string;
  name: string;
  description: string;
  event: string;
  vars: StartVar[];
  dsl: Record<string, unknown>;
};

export const V = {
  user_token: { name: "user_token", kind: "text-input", label: "Access token AI-System của user" },
  agent_key: { name: "agent_key", kind: "text-input", label: "Key agent (TU)" },
  persona_project: { name: "persona_project", kind: "text-input", label: "Project persona KH" },
  actor: { name: "actor", kind: "text-input", label: "Phiên (X-KH-Actor)" },
  prompt: { name: "prompt", kind: "paragraph", label: "Lời nhắn của lượt" },
  tool_name: { name: "tool_name", kind: "text-input", label: "Tên tool" },
  tool_input: { name: "tool_input", kind: "paragraph", label: "Tham số tool (JSON)" },
  last_answer: { name: "last_answer", kind: "paragraph", label: "Câu trả lời cuối của agent" },
} satisfies Record<string, StartVar>;

export const KH_HEADERS = [
  `Authorization:Bearer ${ref("start", "user_token")}`,
  `X-KH-Agent:${ref("start", "agent_key")}`,
  `X-KH-Actor:${ref("start", "actor")}`,
];

export type HookEnv = { khUrl: string; personaPath: string };

export const envVars = (e: HookEnv) => ({ kh_url: e.khUrl, kh_persona_path: e.personaPath });
export const khGet = (id: string, title: string, path: string, params: string[] = []) =>
  http({
    id,
    title,
    method: "get",
    url: `${env("kh_url")}${path}`,
    headers: KH_HEADERS,
    params,
    timeout: [10, 40, 40],
  });

export const ok = `def ok(status, body):
    try:
        return 200 <= int(status) < 300 and bool((body or "").strip())
    except Exception:
        return False
`;

export function build(f: Omit<HookFlow, "dsl">, nodes: AppSpec["nodes"], e: HookEnv): HookFlow {
  return {
    ...f,
    dsl: app({ name: f.key, description: f.description, envVars: envVars(e), nodes }),
  };
}
