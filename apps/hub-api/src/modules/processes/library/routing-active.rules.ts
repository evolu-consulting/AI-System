// cr120-handson-fixes · khe opt-in chỉ BẬT khi có luật HOẶC có quy trình trong tập gán (cùng nguồn `moderationOn` của Community);
// khe thường luôn bật (có mặc định khe). Thuần.
export function slotActive(optIn: boolean, ruleCount: number, assignedCount: number): boolean {
  return !optIn || ruleCount > 0 || assignedCount > 0;
}
