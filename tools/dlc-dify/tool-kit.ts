// dlc-dify · bộ dựng chung cho tool (flow Dify) gắn agent qua MCP Hub: header, biến start, khung app một tool, node `fmt`.
import { app, code, end, env, type Node, ref, type StartVar, start } from "./dsl";

export type ToolFlow = {
  key: string;
  name: string;
  description: string;
  vars: StartVar[];
  dsl: Record<string, unknown>;
};
export type ToolEnv = { hubUrl: string; wsUrl: string; wsToken: string; khUrl: string };

export const PY = `import json
def resp(raw):
    try:
        return json.loads(raw or "{}")
    except Exception:
        return {"raw": raw}
`;
export const WS = [`Authorization:Bearer ${env("ws_token")}`, "Content-Type:application/json"];
export const HUB = [
  `Authorization:Bearer ${ref("start", "hub_ticket")}`,
  "Content-Type:application/json",
];
export const T = (name: string, label: string, required = false): StartVar => ({
  name,
  label,
  kind: "text-input",
  required,
});
export const P = (name: string, label: string, required = false): StartVar => ({
  name,
  label,
  kind: "paragraph",
  required,
});
export const PROJECT = T("project", "Id project (workspace DLC)", true);
export const BRANCH = T("branch", "Nhánh (main hoặc task-<id>)");

export function tool(
  e: ToolEnv,
  key: string,
  name: string,
  description: string,
  vars: StartVar[],
  nodes: Node[],
): ToolFlow {
  return {
    key,
    name,
    description,
    vars,
    dsl: app({
      name: key,
      description,
      envVars: { hub_url: e.hubUrl, ws_url: e.wsUrl, ws_token: e.wsToken, kh_url: e.khUrl },
      nodes: [start(vars), ...nodes, end({ text: ["fmt", "text"] })],
    }),
  };
}

export const fmt = (inputs: Record<string, [string, string]>, body: string) =>
  code({ id: "fmt", title: "Kết quả", inputs, outputs: ["text"], code: `${PY}\n${body}` });
