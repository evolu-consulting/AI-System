// CR-134 · khuôn loading chung: lần đầu ⇒ khung xương (Skeleton); tải lại khi dữ liệu cũ còn ⇒ GIỮ dữ liệu cũ + chỉ báo mảnh trên khối;
// không bao giờ để số liệu tự đổi mà không báo. Hook truy vấn dùng `placeholderData: keepPreviousData` để dữ liệu cũ còn khi khoá đổi.
export type LoadPhase = "first" | "refreshing" | "error" | "idle";

/** Trạng thái tải rút gọn của một truy vấn (cấu trúc tối thiểu của `UseQueryResult`). */
export function loadPhase(q: {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  data: unknown;
}): LoadPhase {
  if (q.data === undefined)
    return q.isError ? "error" : q.isPending || q.isFetching ? "first" : "idle";
  return q.isFetching ? "refreshing" : "idle";
}
