// CR-161 · lát 5 · mã hoá thuần cho route kết nối: con trỏ phân trang (spec §3, CR-151) và kiểm đường dẫn chuông.
// Không I/O. `decodeCursor` null ⇒ route trả 400. `isContractsLink`: chuông chỉ nhận đường dẫn tương đối của app Hợp đồng (Minor #2 lát 2).
import { z } from "zod";

const CursorSchema = z.strictObject({ t: z.iso.datetime(), id: z.uuid() });
export type Cursor = z.infer<typeof CursorSchema>;

/** `cursor` = base64url của `{t: iso, id: uuid}` (keyset `(t, id)` DESC). */
export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ t: c.t, id: c.id })).toString("base64url");
}

export function decodeCursor(s: string): Cursor | null {
  try {
    const r = CursorSchema.safeParse(JSON.parse(Buffer.from(s, "base64url").toString("utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const LINK_RE = /^\/contracts(\/[A-Za-z0-9._~%-]+)*(\?[A-Za-z0-9._~%=&-]*)?$/;
/** Link chuông hợp lệ: bắt đầu `/contracts`, không `//`, không lược đồ, không ký tự lạ (chặn chuyển hướng ra ngoài). */
export function isContractsLink(link: string): boolean {
  return link.length <= 500 && LINK_RE.test(link);
}
