// HUB-FR-140 · HUB-BR-30 · FB1 §3.3 (core-only) · nguồn Bearer FileBox đọc từ ENV `FILEBOX_TOKEN` (không qua hub.secrets ở v1 lõi).
// `get()`/`refresh()` trả giá trị env (hoặc null ⇒ fail-closed khi thiếu). Token KHÔNG log, KHÔNG vào job/trace/FE.
import type { FileboxTokenSource } from "./filebox.client";

/** `FileboxTokenSource` từ biến môi trường `FILEBOX_TOKEN`; vắng ⇒ `null` (fail-closed). Env không xoay nên refresh = get. */
export function envFileboxToken(token: string | undefined): FileboxTokenSource {
  const value = token && token.length > 0 ? token : null;
  return { get: async () => value, refresh: async () => value };
}
