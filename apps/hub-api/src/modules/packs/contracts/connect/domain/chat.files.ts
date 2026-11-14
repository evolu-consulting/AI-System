// CR-161 · lát 6 · tệp trò chuyện (R11), luật thuần. `cc_files.id` = uuid do route sinh, `storage_key` = `<tenant bên tải>/<id>` (CHECK `cc_files_key_ck`)
// ⇒ từ khoá suy ra org FileBox (`t_<tenant>`). `file_id` của FileBox (THẬT: 16 hex, không phải uuid) lưu riêng ở `cc_files.box_file_id` (hub 0148).
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_RE = new RegExp(`^(${UUID})/(${UUID})$`, "i");

export const fileKeyOf = (tenant: string, id: string): string => `${tenant}/${id}`;

/** `<tenant>/<id>` → phần tử; sai dạng ⇒ null. */
export function fileKeyParts(key: string): { tenant: string; id: string } | null {
  const m = KEY_RE.exec(key);
  return m ? { tenant: m[1] as string, id: m[2] as string } : null;
}
