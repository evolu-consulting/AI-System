// CR-169 · tệp tin nhắn `partner` (luật thuần). `hub.pmsg_files.storage_key` = `<tenant bên tải>/<id tệp>` (DB kiểm khi `pmsg_file_add`) ⇒ suy ra org FileBox
// (`t_<tenant>`) của bên tải. `file_id` FileBox THẬT (16 hex, không phải uuid) lưu riêng ở `box_file_id`.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_RE = new RegExp(`^(${UUID})/(${UUID})$`, "i");

export const fileKeyOf = (tenant: string, id: string): string => `${tenant}/${id}`;

/** `<tenant>/<id>` → phần tử; sai dạng ⇒ null. */
export function fileKeyParts(key: string): { tenant: string; id: string } | null {
  const m = KEY_RE.exec(key);
  return m ? { tenant: m[1] as string, id: m[2] as string } : null;
}
