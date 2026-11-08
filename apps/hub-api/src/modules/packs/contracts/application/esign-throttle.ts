// CR-125 · cr125-esign-refresh-throttle · bảo vệ hạn mức API nhà cung cấp: phong bì vừa được đồng bộ < `ESIGN_SYNC_GAP_MS` trước ⇒ lần "làm mới"
// / kiểm lượt kế tiếp bỏ qua lời gọi nhà cung cấp, trả trạng thái hiện có trong DB. Chỉ áp cho lệnh do người dùng bấm (refresh, kiểm lượt
// của Ký ngay); webhook và vòng đồng bộ nền KHÔNG qua đây. Bộ nhớ theo tiến trình (nhiều instance ⇒ mỗi instance giữ mốc riêng — chỉ giảm
// tải, không ảnh hưởng đúng đắn). Đồng hồ tiêm vào (`now`) để test không ngủ chờ.
export const ESIGN_SYNC_GAP_MS = 10_000;

export function syncThrottle(now: () => Date, gapMs = ESIGN_SYNC_GAP_MS) {
  const last = new Map<string, number>();
  return {
    /** Phong bì vừa đồng bộ trong khoảng `gapMs` ⇒ true (bỏ qua lời gọi). */
    recent: (envelopeId: string): boolean => {
      const at = last.get(envelopeId);
      return at !== undefined && now().getTime() - at < gapMs;
    },
    /** Ghi mốc đồng bộ thành công; dọn mốc đã hết hạn để Map không phình. */
    mark: (envelopeId: string): void => {
      const t = now().getTime();
      for (const [k, v] of last) if (t - v >= gapMs) last.delete(k);
      last.set(envelopeId, t);
    },
  };
}
