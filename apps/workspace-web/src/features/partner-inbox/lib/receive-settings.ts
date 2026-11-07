// CR-124 · q4 · spec §6 · cài đặt NHẬN hợp đồng đối tác: ngưỡng mức quan trọng nhập theo TRIỆU đồng (quản trị nghĩ theo triệu), lưu theo đồng.
export const MILLION = 1_000_000;
export type ReceiveSettings = {
  important_min: number;
  critical_min: number;
  owner_user_id: string | null;
};
export type ReceiveDraft = { importantM: number; criticalM: number; owner: string };

export const draftOf = (s: ReceiveSettings): ReceiveDraft => ({
  importantM: Math.round(s.important_min / MILLION),
  criticalM: Math.round(s.critical_min / MILLION),
  owner: s.owner_user_id ?? "",
});

export const settingsOf = (d: ReceiveDraft): ReceiveSettings => ({
  important_min: Math.round(d.importantM) * MILLION,
  critical_min: Math.round(d.criticalM) * MILLION,
  owner_user_id: d.owner === "" ? null : d.owner,
});

/** Ngưỡng «Rất quan trọng» phải lớn hơn ngưỡng «Quan trọng»; ngưỡng ≥ 0. */
export const settingsIssue = (d: ReceiveDraft): "order" | "negative" | null =>
  d.importantM < 0 || d.criticalM < 0 ? "negative" : d.criticalM <= d.importantM ? "order" : null;
