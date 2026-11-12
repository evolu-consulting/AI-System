// FIX-EV (CR-127): mảng JS truyền thẳng vào `${…}::uuid[]` bị drizzle bung thành danh sách tham số (`$1, $2`) ⇒ một phần tử thành
// chuỗi đơn ⇒ Postgres "malformed array literal" (500). Truyền MỘT tham số văn bản dạng `{a,b}` (id đã qua zod uuid). Rỗng/vắng ⇒ null.
export const uuidArrLit = (ids: readonly string[] | null | undefined): string | null =>
  ids?.length ? `{${ids.join(",")}}` : null;
