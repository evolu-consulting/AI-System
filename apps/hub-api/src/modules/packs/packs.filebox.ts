// T5f · FileBox của gói (tách khỏi `packs.mount.ts` giữ trần 400 dòng — cf-esign-docusign dùng chung). Chỗ duy nhất dựng
// `FileboxClient` cho gói: `deps.packs.filebox` ưu tiên, vắng ⇒ env FB1 (`FILEBOX_URL` + `FILEBOX_TOKEN`, CA `FILEBOX_CA`).
import { logger } from "../../lib/logger";
import { FileboxClient } from "../attachments/filebox.client";
import { envFileboxToken } from "../attachments/filebox-token";

export type PackFb = { url: string; token: string; caPath?: string; publicPath?: string };

/** Client FileBox theo org `t_<tenant>` (mỗi lời gọi một org, PK-FR-06). */
export function fileboxClients(fb: PackFb) {
  const token = envFileboxToken(fb.token);
  return (org: string) =>
    new FileboxClient({ ...fb, org, token, timeoutMs: 10_000, retryDelaysMs: [200], log: logger });
}

export function packFilebox(
  p: { filebox?: { url: string; token: string } } | undefined,
): PackFb | null {
  if (p?.filebox) return p.filebox;
  const { FILEBOX_URL: url, FILEBOX_TOKEN: token, FILEBOX_CA: caPath } = process.env;
  const publicPath = process.env.FILEBOX_PUBLIC_PATH?.replace(/\/+$/, "");
  return url && token
    ? { url, token, ...(caPath ? { caPath } : {}), ...(publicPath ? { publicPath } : {}) }
    : null;
}
