// ADM-NFR-07 · điểm dừng tất định cho test khoá hàng (plan M2 §6, G8). `createApp` chỉ chuyển hook xuống service khi
// `appEnv === "test"`; production/development luôn `undefined`. Hook chỉ đợi một Promise do test giữ, không I/O
// (TECH-DEBT #13: callback withScope có thể chạy lại).
export type HookOp =
  | "command.save"
  | "command.delete"
  | "feature.save"
  | "feature.delete"
  | "workflow.save";
/** `locked`: vừa giữ đủ khoá, trước kiểm luật/ghi. `names`: command vừa ghi `command_names` (giữ khoá ngầm của
 * unique index), trước khi khoá features — để test thứ tự khoá tên → features (review M2 v2 #1). */
export type HookStep = "locked" | "names";
export type TestHooks = { afterLock?: (op: HookOp, step: HookStep) => Promise<void> };

export async function afterLock(
  hooks: TestHooks | undefined,
  op: HookOp,
  step: HookStep = "locked",
): Promise<void> {
  await hooks?.afterLock?.(op, step);
}
