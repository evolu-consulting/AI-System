// CR-157: nhãn HĐ nhập tay — một nguồn cho chi tiết, danh sách, người duyệt. Chưa đối chiếu ⇒ «cần đối chiếu»; đã đối chiếu ⇒ «… bởi X».
export function manualTagKey(
  reconciled: boolean,
  by: string | null,
): { key: string; vars?: { name: string } } {
  if (!reconciled) return { key: "contracts.review.manualTag.pending" };
  return by
    ? { key: "contracts.review.manualTag.doneBy", vars: { name: by } }
    : { key: "contracts.review.manualTag.done" };
}
