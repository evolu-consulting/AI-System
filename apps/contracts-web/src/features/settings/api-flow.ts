// CR-105 L4 · quy trình duyệt đang dùng (chỉ đọc): `GET /pack/contracts/approval-flow`. Không còn PUT (quy trình sửa ở ai-admin).
import { api } from "@ai/web-kit/http";
import { type CurrentFlow, toCurrentFlow } from "./lib/current-flow";

export const flowKeys = { flow: ["settings", "flow"] as const };

export async function fetchFlow(signal?: AbortSignal): Promise<CurrentFlow> {
  const raw = await api<unknown>("/pack/contracts/approval-flow", { signal });
  const flow = toCurrentFlow(raw);
  if (!flow) throw new Error("approval-flow: unexpected shape");
  return flow;
}
