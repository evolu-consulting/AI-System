// CR-161 · lát 6 · tệp trò chuyện (R11), luật thuần. `cc_files.id` = `file_id` của FileBox (uuid) và `storage_key` = `<tenant bên tải>/<id>` (CHECK
// `cc_files_key_ck`) ⇒ từ khoá suy ra org FileBox (`t_<tenant>`) + id: không cần cột phụ (G1), không migration.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");
const KEY_RE = new RegExp(`^(${UUID})/(${UUID})$`, "i");

export const isUuid = (s: string): boolean => UUID_RE.test(s);
export const fileKeyOf = (tenant: string, id: string): string => `${tenant}/${id}`;

/** `<tenant>/<id>` → phần tử; sai dạng ⇒ null. */
export function fileKeyParts(key: string): { tenant: string; id: string } | null {
  const m = KEY_RE.exec(key);
  return m ? { tenant: m[1] as string, id: m[2] as string } : null;
}
