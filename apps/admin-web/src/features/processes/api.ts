// ADM-FR-65 · CR-056 · P-a FD2: `features/processes/api.ts` của admin-web — nơi duy nhất gọi Hub `/process-defs*`.
// Bước 0 chỉ có dò cờ; PF4 (F5) bổ sung `useProcessDefs`, `useRunDef`, … vào đây.
import { ApiError, api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

export type EngineState = "on" | "off" | "unknown";

/** `GET /process-defs?limit=1&include_templates=false`: 200 ⇒ on; 404/403 ⇒ off; Hub chưa cấu hình ⇒ off; lỗi khác ném (⇒ unknown). */
export async function probeEngine(): Promise<EngineState> {
  const url = hubConfigured() ? hubUrl("/process-defs") : null;
  if (url === null) return "off";
  try {
    await api<unknown>(url, { query: { limit: 1, include_templates: "false" } });
    return "on";
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return "off";
    throw err;
  }
}
