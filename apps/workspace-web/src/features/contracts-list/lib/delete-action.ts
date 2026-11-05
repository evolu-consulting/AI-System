// Nút Xoá ở dòng danh sách: chỉ vai quản lý thấy; HĐ nhiều phiên bản ⇒ khoá (server trả 409 CONTRACT_HAS_VERSIONS).
export type DeleteAction = "hidden" | "versions" | "enabled";

export function deleteAction(r: { versions_count?: number | null }, owner: boolean | undefined) {
  if (!owner) return "hidden" as const;
  return (r.versions_count ?? 1) > 1 ? ("versions" as const) : ("enabled" as const);
}
