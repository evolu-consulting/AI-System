// CR-121 c14b · thanh lưu chung của tab Cài đặt: MỘT lần bấm Lưu lưu Thông tin rồi Quota TUẦN TỰ (hai form dùng chung `version` công ty:
// lần 2 chỉ gửi khi lần 1 đã xong và trang đã nhận `version` mới). Máy trạng thái thuần để kiểm thử; SettingsTab nối vào sự kiện thật.
export type SettingsForm = "info" | "quota";

export function saveOrder(dirty: { info: boolean; quota: boolean }): SettingsForm[] {
  return [...(dirty.info ? (["info"] as const) : []), ...(dirty.quota ? (["quota"] as const) : [])];
}

export type FlowState = {
  step: "idle" | SettingsForm;
  /** `version` công ty lúc gửi form Thông tin (đổi ⇒ lần lưu thành công). */
  version: number;
  /** Còn Quota phải lưu sau Thông tin. */
  quotaAfter: boolean;
  /** Thông tin đã lưu trong lần bấm này. */
  infoSaved: boolean;
};
export type FlowEvent =
  | { t: "click"; dirty: { info: boolean; quota: boolean }; version: number }
  /** Lời gọi lưu Thông tin vừa kết thúc; `version` là bản công ty hiện tại. */
  | { t: "infoSettled"; version: number }
  | { t: "quotaSettled"; ok: boolean };
export type FlowAction =
  | "submit-info"
  | "submit-quota"
  /** Thông tin lỗi/xung đột nên Quota CHƯA được gửi — báo rõ cả hai chưa lưu. */
  | "info-failed-quota-skipped"
  /** Quota lỗi SAU KHI Thông tin đã lưu — báo phần nào đã lưu, phần nào chưa. */
  | "quota-failed-after-info";

export const IDLE: FlowState = { step: "idle", version: 0, quotaAfter: false, infoSaved: false };

type Result = [FlowState, FlowAction[]];

function onClick(e: Extract<FlowEvent, { t: "click" }>): Result {
  const [first] = saveOrder(e.dirty);
  if (!first) return [IDLE, []];
  const state: FlowState = {
    step: first,
    version: e.version,
    quotaAfter: first === "info" && e.dirty.quota,
    infoSaved: false,
  };
  return [state, [first === "info" ? "submit-info" : "submit-quota"]];
}

function onInfoSettled(s: FlowState, version: number): Result {
  if (version === s.version) return [IDLE, s.quotaAfter ? ["info-failed-quota-skipped"] : []];
  if (!s.quotaAfter) return [IDLE, []];
  return [{ ...s, step: "quota", version, infoSaved: true }, ["submit-quota"]];
}

export function flow(s: FlowState, e: FlowEvent): Result {
  if (e.t === "click") return onClick(e);
  if (e.t === "infoSettled" && s.step === "info") return onInfoSettled(s, e.version);
  if (e.t === "quotaSettled" && s.step === "quota")
    return [IDLE, !e.ok && s.infoSaved ? ["quota-failed-after-info"] : []];
  return [s, []];
}
