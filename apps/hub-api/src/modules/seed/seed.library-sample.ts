// CR-127 Z3c · cổng bật dữ liệu mẫu dev/test (trước đây cũng ghi "QT thử" trên khe `contracts.approval` — đã gỡ: khe duyệt HĐ không còn).

/** Chỉ khi bật fixtures VÀ không phải production (hai lớp chặn: `deploy/prod-sohoptac2/setup.sh` không đặt HUB_SEED_FIXTURES). */
export const libSampleEnabled = (appEnv: string, fixtures: boolean): boolean =>
  fixtures && appEnv !== "production";
