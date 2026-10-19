// M2-chat · N2-FR-03 · thuần: tool gói (registry N2) mà agent `agentic-cli` được gọi qua `/mcp` = `runtime_options.pack_tools`
// (Studio/seed khai). Chỉ là DANH SÁCH ĐƯỢC PHÉP vào `payload.mcp.tools`: `/mcp` vẫn lọc tiếp (tool có trong registry, không
// side_effect, gói bật cho tenant, user của job có quyền gói đúng `action`) — `pack-tools.provider.ts`. Khoá sai dạng bị bỏ.

import { PROCESS_KEY_RE } from "@ai/contracts/chat";
import { MCP_TOOLS_MAX } from "@ai/contracts/hub";

/** `runtime_options.pack_tools` → khoá hợp lệ, không trùng, giữ thứ tự; vắng/sai kiểu ⇒ []. */
export function packToolKeys(runtimeOptions: Record<string, unknown>): string[] {
  const v = runtimeOptions.pack_tools;
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const k of v)
    if (typeof k === "string" && PROCESS_KEY_RE.test(k) && !out.includes(k)) out.push(k);
  return out;
}

/** Gộp tool gói vào khoá workflow catalog (catalog trước), trần `MCP_TOOLS_MAX`. */
export function withPackTools(
  keys: readonly string[],
  runtimeOptions: Record<string, unknown>,
): string[] {
  const out = [...keys];
  for (const k of packToolKeys(runtimeOptions))
    if (out.length < MCP_TOOLS_MAX && !out.includes(k)) out.push(k);
  return out;
}
