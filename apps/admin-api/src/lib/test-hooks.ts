// ADM-NFR-07, ADM-FR-53 · điểm dừng tất định cho test khoá hàng (plan M2 §6, G8; plan M3 §5.1, §6.3). `createApp` chỉ
// chuyển hook xuống service khi `appEnv === "test"`; production/development luôn `undefined`. Hook chỉ đợi một Promise
// do test giữ (hoặc ném để giả 40P01), không I/O (TECH-DEBT #13: callback withScope có thể chạy lại).
export type HookOp =
  | "command.save"
  | "command.delete"
  | "feature.save"
  | "feature.delete"
  | "workflow.save"
  | "group.save"
  | "group.delete"
  | "group.members"
  | "grant.save"
  | "grant.batch"
  | "grant.matrix"
  | "entitlement.save"
  | "tenant.save"
  | "user.save"
  | "secret.save";
/**
 * `locked`: sau câu khoá CUỐI của luồng, trước kiểm luật. `names` (M2): command vừa ghi `command_names`, trước khi khoá
 * features. `rows`: sau câu ghi CUỐI, trước bump. `bump`: `configWrite` gọi ngay trước upsert `config_meta` (chỉ khi có
 * sự kiện). `cols` (chỉ `grant.matrix`, đọc): sau câu cột group, trước câu hàng feature.
 */
export type HookStep = "locked" | "names" | "rows" | "bump" | "cols";
export type TestHooks = {
  afterLock?: (op: HookOp, step: HookStep) => Promise<void> | void;
};

export async function afterLock(
  hooks: TestHooks | undefined,
  op: HookOp,
  step: HookStep = "locked",
): Promise<void> {
  await hooks?.afterLock?.(op, step);
}
