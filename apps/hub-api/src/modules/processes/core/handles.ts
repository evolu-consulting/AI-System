// HUB-FR-106 · HUB-FR-113 · N3 · tay cầm cho test gọi một lượt vòng nền khi `processLoops:false` (plan-contract §7.1).
// Nhận qua `AppDeps.onProcessHandles`. Chủ: `sweepOnce` PF1 (`runs/sweeps.ts`), `remindOnce` PF3 (`notify/reminder.ts`),
// `postThreadOnce` B0 (`core/thread-poster.ts`), `kick` = `StageLauncher.kick`, `khWriteOnce` K1 (`kh/kh.writer.ts`, G2).
export type SweepResult = { queued: number; interrupted: number; expired: number };

export type ProcessHandles = {
  sweepOnce(): Promise<SweepResult>;
  remindOnce(): Promise<number>;
  postThreadOnce(): Promise<number>;
  kick(runId: string): Promise<void>;
  /** K1 · G2 · một lô bộ gửi Tóm tắt; số hàng đã xử lý (0 khi không có KH runtime). */
  khWriteOnce(): Promise<number>;
};
