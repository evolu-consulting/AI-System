// Nút Xoá ở dòng danh sách: hiện theo `can_delete` do máy chủ tính (cùng luật `canDeleteContract` với chi tiết/guard xoá);
// HĐ nhiều phiên bản ⇒ khoá (server trả 409 CONTRACT_HAS_VERSIONS).
export type DeleteAction = "hidden" | "versions" | "enabled";

export function deleteAction(r: {
  can_delete?: boolean | undefined;
  versions_count?: number | null;
}) {
  if (r.can_delete !== true) return "hidden" as const;
  return (r.versions_count ?? 1) > 1 ? ("versions" as const) : ("enabled" as const);
}
