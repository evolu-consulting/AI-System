// Dùng CHỈ trong test: app của feature mẫu theo quy ước khoá (đúng như backfill admin 0037). Code chạy thật đọc cột `app` từ API.
import type { AppId } from "./feature-meta";

export function appOfKey(key: string): AppId {
  if (key === "core") return "core";
  if (key === "chat-app") return "chat";
  if (key === "han-muc-duyet") return "contracts";
  const prefix = key.split("-")[0];
  return prefix === "community" || prefix === "contracts" || prefix === "knowledge"
    ? prefix
    : "other";
}

/** `{ key, app }` cho khoá mẫu. */
export const featOf = (key: string): { key: string; app: AppId } => ({ key, app: appOfKey(key) });
