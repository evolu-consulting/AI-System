// HUB-FR-146 · security P-d2 m2 (review.md "Security P-d2") · chọn driver cho stage vừa kick — thuần, không I/O.
// Stage `tool` CHỈ chạy bằng `toolDriver`; thiếu ⇒ `missing` (launcher quyết `tool_failed`), KHÔNG rơi về `stageDriver`
// (driver agent không biết gọi tool, và bỏ qua kiểm quyền/công tắc/side_effect lúc gọi của tool-driver).

export type DriverKind = "tool" | "stage" | "missing";

export function driverKindOf(isTool: boolean, hasToolDriver: boolean): DriverKind {
  if (!isTool) return "stage";
  return hasToolDriver ? "tool" : "missing";
}
