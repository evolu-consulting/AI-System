// HUB-FR-106 · N3 · đồng hồ mọi mốc quy trình (`expires_at`, `remind_at`, mốc đối chiếu 60 s) — seam `AppDeps.now`
// (plan-contract §7.1). SQL so với tham số lấy từ đây, KHÔNG dùng `now()` của Postgres ⇒ test điều khiển được thời gian.
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** `AppDeps.now` vắng ⇒ đồng hồ hệ thống. */
export const clockOf = (now?: Clock): Clock => now ?? systemClock;
