// CR-184 · con trỏ tải dần của lịch sử uỷ quyền (CONVENTIONS §6): `(thời điểm, id)` của hàng cuối trang, mã hoá base64url. Thời điểm giữ nguyên
// micro-giây (chuỗi do chính SQL trả) để so sánh `=` không lệch. Sai định dạng ⇒ 422 VALIDATION_ERROR.
import { z } from "zod";
import { appError } from "../../../lib/errors";

export type PageCursor = { at: string; id: string };
const CursorSchema = z.tuple([
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  z.uuid(),
]);

export const encodeCursor = (c: PageCursor): string =>
  Buffer.from(JSON.stringify([c.at, c.id])).toString("base64url");

export function decodeCursor(raw: string | undefined): PageCursor | null {
  if (raw === undefined) return null;
  try {
    const [at, id] = CursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return { at, id };
  } catch {
    throw appError("VALIDATION_ERROR");
  }
}
