// CR-104 · ops-core · cổng repo của ops-watch (lớp 2): application/route chỉ biết giao diện này; `adapters/ops.repo.ts` hiện thực
// (SQL), `ops.mount.ts` tiêm. Luật 4c: số câu SQL mỗi lượt do adapter giữ cố định.
import type {
  OpsCheckKey,
  OpsCheckRow,
  OpsEvent,
  OpsSettings,
  OpsStatus,
} from "@ai/contracts/hub-admin";
import type { OpsNotifyItem, Transition } from "../domain/ops.rules";
import type { OpsCheckOutcome } from "./ops.check";

export type OpsState = {
  settings: OpsSettings;
  updated_at: Date;
  updated_by: string | null;
  last_round_at: Date | null;
  last_manual_at: Date | null;
};

export interface OpsRepo {
  state(): Promise<OpsState>;
  /** Trạng thái + giá trị lượt trước của mọi check (một câu), bỏ kết quả cũ hơn `staleBefore`. */
  previous(
    staleBefore: Date,
  ): Promise<Partial<Record<OpsCheckKey, { status: OpsStatus; value: unknown }>>>;
  /** Giành lượt nền: thành công ⇔ `last_round_at` trong DB vẫn là giá trị đã đọc. */
  claimRound(seen: Date | null, now: Date): Promise<boolean>;
  /** "Kiểm tra ngay": giành khi lần bấm cuối cũ hơn `gapMs`. */
  claimManual(now: Date, gapMs: number): Promise<boolean>;
  /** Ghi một lượt trong MỘT tx; `toNotify` (luật thuần) chọn chuyển trạng thái nào báo chuông. */
  writeRound(
    rs: readonly OpsCheckOutcome[],
    now: Date,
    toNotify: (ts: readonly Transition[]) => OpsNotifyItem[],
  ): Promise<{ transitions: Transition[]; notified: number }>;
  status(): Promise<{ checks: OpsCheckRow[]; events: OpsEvent[]; state: OpsState }>;
  saveSettings(next: OpsSettings, actor: string, now: Date): Promise<OpsState>;
}
