// CR-114 hub-fast-sdk · luật chọn đường SDK trực tiếp (thuần): lượt chat ngắn của agent KHÔNG cần sandbox CLI / tool trên đĩa
// chạy bằng Anthropic SDK trong Hub (bỏ spawn CLI ~1–7 s). Mặc định TẮT: chỉ khi agent bật `runtime_options.direct_sdk = true`.
// Mọi thứ cần CLI (file đính kèm, nguồn chỉ-đọc, job stage/KH, autofix, tool workflow/MCP, tool gói, `Write`) ⇒ giữ đường job.

export const DIRECT_SDK_FLAG = "direct_sdk";
export const DEFAULT_DIRECT_SDK_MODEL = "claude-opus-5-5";

export type DirectSdkInput = {
  runtime: string;
  runtimeOptions: Readonly<Record<string, unknown>>;
  /** SDK đã cấu hình (khoá API có). */
  sdkReady: boolean;
  fileCount: number;
  sourceCount: number;
  stage: boolean;
  autofix: boolean;
  /** Số workflow (tool MCP) gắn agent. */
  workflowCount: number;
  /** Số tool gói (`pack_tools`) của agent. */
  packToolCount: number;
};
export type DirectSdkVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: "flag_off" | "runtime" | "sdk_off" | "files" | "sources" | "stage" | "tools";
    };

export function directSdkRoute(i: DirectSdkInput): DirectSdkVerdict {
  if (i.runtimeOptions[DIRECT_SDK_FLAG] !== true) return { ok: false, reason: "flag_off" };
  if (i.runtime !== "agentic-cli") return { ok: false, reason: "runtime" };
  if (!i.sdkReady) return { ok: false, reason: "sdk_off" };
  if (i.fileCount > 0) return { ok: false, reason: "files" };
  if (i.sourceCount > 0) return { ok: false, reason: "sources" };
  if (i.stage || i.autofix) return { ok: false, reason: "stage" };
  if (i.workflowCount > 0 || i.packToolCount > 0) return { ok: false, reason: "tools" };
  return { ok: true };
}

/** Model của đường SDK: `runtime_options.model` → `agent.model` → env → mặc định. */
export function directSdkModel(
  runtimeOptions: Readonly<Record<string, unknown>>,
  agentModel: string | null | undefined,
  envModel: string | undefined,
): string {
  const own = runtimeOptions.model;
  if (typeof own === "string" && own.trim()) return own.trim();
  if (agentModel?.trim()) return agentModel.trim();
  return envModel?.trim() || DEFAULT_DIRECT_SDK_MODEL;
}
