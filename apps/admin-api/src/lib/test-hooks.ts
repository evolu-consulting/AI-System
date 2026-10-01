// ADM-NFR-07 · điểm dừng tất định cho test khoá hàng (plan M2 §6, G8). `createApp` chỉ chuyển hook xuống service khi
// `appEnv === "test"`; production/development luôn `undefined`. Hook chỉ đợi một Promise do test giữ, không I/O
// (TECH-DEBT #13: callback withScope có thể chạy lại).
export type HookOp =
  | "command.save"
  | "command.delete"
  | "feature.save"
  | "feature.delete"
  | "workflow.save";
export type TestHooks = { afterLock?: (op: HookOp, step: "locked") => Promise<void> };

/** Gọi ngay sau khi đã giữ đủ khoá, trước bước kiểm luật/ghi. */
export async function afterLock(hooks: TestHooks | undefined, op: HookOp): Promise<void> {
  await hooks?.afterLock?.(op, "locked");
}
