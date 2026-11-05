// CR-121 D-2 · câu tiếng Việt/Anh "nói cách sửa" cho lỗi kiểm khi xuất bản / gán quy trình thư viện. Thuần, không I/O.
// Mỗi vi phạm `{path, rule}` của khe ⇒ `{step, field, message (vi), message_en}`: `step` đánh số từ 1 như màn hình sửa quy trình.
import type { PublishIssue } from "./library-publish.rules";

export type ExplainedIssue = PublishIssue & {
  /** Bước (từ 1) bị lỗi; null ⇒ lỗi chung của quy trình. */
  step: number | null;
  /** Trường của bước (vd `when`, `department_group_id`); null ⇒ cả bước/quy trình. */
  field: string | null;
  message: string;
  message_en: string;
};

type Msg = { vi: string; en: string };
type Ctx = { step: string; field: string; param: string };
const M = (vi: string, en: string): Msg => ({ vi, en });

const RULES: Record<string, (c: Ctx) => Msg> = {
  STEPS_MAX: () =>
    M(
      "Quy trình có từ 1 đến 20 bước — hãy bớt bước hoặc gộp các bước giống nhau.",
      "A process has 1 to 20 steps — remove or merge steps.",
    ),
  FIRST_NOT_REVIEW: (c) =>
    M(
      `${c.step}: bước đầu tiên phải là bước duyệt — đưa một bước duyệt lên đầu.`,
      `${c.step}: the first step must be an approval step — move one to the top.`,
    ),
  FIRST_CONDITIONAL: (c) =>
    M(
      `${c.step}: bước đầu tiên luôn phải chạy — xoá điều kiện của bước này.`,
      `${c.step}: the first step always runs — remove its condition.`,
    ),
  AFTER_DIFY_CONDITIONAL: (c) =>
    M(
      `${c.step}: bước ngay sau trợ lý AI / Thông báo / Chờ tới không được có điều kiện — xoá điều kiện hoặc chèn một bước duyệt ở giữa.`,
      `${c.step}: a step right after an AI assistant / notification / wait cannot be conditional — remove the condition or insert an approval step between.`,
    ),
  KEY_DUP: (c) =>
    M(
      `${c.step}: mã bước bị trùng — đặt mã khác cho bước này.`,
      `${c.step}: duplicate step key — give this step a different key.`,
    ),
  GROUP_REQUIRED: (c) =>
    M(
      `${c.step}: bước duyệt chưa chọn phòng ban — chọn phòng ban hoặc người duyệt cho bước này.`,
      `${c.step}: no department chosen — pick a department or an approver.`,
    ),
  ESCALATE_SAME_GROUP: (c) =>
    M(
      `${c.step}: phòng ban chuyển cấp trùng phòng ban duyệt — chọn phòng ban cấp trên khác.`,
      `${c.step}: the escalation department equals the approving one — choose another.`,
    ),
  DUE_RANGE: (c) =>
    M(
      `${c.step}: hạn duyệt phải từ 4 đến 2160 giờ — nhập lại số giờ.`,
      `${c.step}: the deadline must be 4 to 2160 hours.`,
    ),
  REMIND_RANGE: (c) =>
    M(
      `${c.step}: chu kỳ nhắc phải từ 4 đến 168 giờ — nhập lại hoặc để trống.`,
      `${c.step}: the reminder interval must be 4 to 168 hours, or empty.`,
    ),
  DIFY_WORKFLOW_UNKNOWN: (c) =>
    M(
      `${c.step}: trợ lý AI chưa được bật cho công ty — chọn trợ lý khác.`,
      `${c.step}: the AI assistant is not enabled — choose another.`,
    ),
  DIFY_PARAM_UNSUPPORTED: (c) =>
    M(
      `${c.step}: trợ lý AI có thông tin bắt buộc mà hợp đồng không cung cấp — chọn trợ lý khác.`,
      `${c.step}: the assistant needs data the contract does not provide — choose another.`,
    ),
  DIFY_INPUT_UNKNOWN: (c) =>
    M(
      `${c.step}: ánh xạ thông tin cho trợ lý AI không khớp — kiểm lại các ô thông tin.`,
      `${c.step}: the assistant input mapping does not match — review the inputs.`,
    ),
  ESIGN_MULTI: () =>
    M(
      "Chỉ được có một bước Ký số — xoá các bước Ký số thừa.",
      "Only one e-signature step is allowed — remove the extra ones.",
    ),
  ESIGN_NOT_LAST: (c) =>
    M(
      `${c.step}: bước Ký số phải ở cuối quy trình — kéo bước Ký số xuống cuối.`,
      `${c.step}: the e-signature step must be last — move it to the end.`,
    ),
  SIGNER_GROUP_REQUIRED: (c) =>
    M(
      `${c.step}: bước Ký số chưa chọn phòng ban người ký — chọn phòng ban.`,
      `${c.step}: pick the signer's department.`,
    ),
  SIGNER_USER_REQUIRED: (c) =>
    M(`${c.step}: bước Ký số chưa chọn người ký — chọn một người ký.`, `${c.step}: pick a signer.`),
  USER_NOT_MEMBER: (c) =>
    M(
      `${c.step}: người được chọn không thuộc công ty hoặc không có quyền ghi — chọn người khác.`,
      `${c.step}: the chosen user is not in the company or lacks write access — pick another.`,
    ),
  // CR-121 D-6 · bước Thông báo / Chờ tới.
  NOTIFY_TO_REQUIRED: (c) =>
    M(
      `${c.step}: bước Thông báo chưa có người nhận — chọn người gửi duyệt, người phụ trách hoặc một phòng ban.`,
      `${c.step}: the notification has no recipient — pick the submitter, the owner or a department.`,
    ),
  NOTIFY_CHANNEL_REQUIRED: (c) =>
    M(
      `${c.step}: bước Thông báo chưa chọn kênh gửi — chọn chuông và/hoặc mail.`,
      `${c.step}: pick a channel — bell and/or email.`,
    ),
  NOTIFY_TITLE_REQUIRED: (c) =>
    M(
      `${c.step}: bước Thông báo chưa có tiêu đề — nhập tiêu đề (có thể dùng {ma_hd}, {ten_hd}, {gia_tri}).`,
      `${c.step}: the notification needs a title (you may use {ma_hd}, {ten_hd}, {gia_tri}).`,
    ),
  WAIT_OFFSET_RANGE: (c) =>
    M(
      `${c.step}: số ngày lệch của bước Chờ tới phải từ -365 đến 365 — nhập lại số ngày.`,
      `${c.step}: the wait offset must be -365 to 365 days.`,
    ),
  SLOT_SHAPE: () =>
    M(
      "Quy trình không đúng dạng — mở lại trong trình sửa và lưu lại.",
      "The process shape is invalid — reopen it in the editor and save again.",
    ),
  GROUP_ID_IN_LIBRARY: (c) =>
    M(
      `${c.step}: quy trình dùng chung phải chọn phòng ban theo mã — chọn lại phòng ban trong danh sách mã.`,
      `${c.step}: shared processes must reference departments by code — pick again.`,
    ),
  NODE_UNSUPPORTED: (c) =>
    M(
      `${c.step}: ứng dụng này chưa hỗ trợ loại bước đó — chọn loại bước trong danh sách của ứng dụng.`,
      `${c.step}: this app does not support that step type — pick a step type from the app's list.`,
    ),
  COND_FIELD_UNDECLARED: (c) =>
    M(
      `${c.step}: điều kiện dùng thông tin '${c.param}' mà ứng dụng chưa cho phép — chọn thông tin khác trong danh sách.`,
      `${c.step}: the condition uses '${c.param}', which the app does not allow — pick another.`,
    ),
  COND_OP_UNSUPPORTED: (c) =>
    M(
      `${c.step}: phép so sánh của điều kiện '${c.param}' không hợp lệ — chọn lại phép so sánh và nhập một số.`,
      `${c.step}: invalid comparison for '${c.param}' — choose another and enter a number.`,
    ),
  COND_VALUE_INVALID: (c) =>
    M(
      `${c.step}: giá trị của điều kiện '${c.param}' không hợp lệ — chọn giá trị trong danh sách.`,
      `${c.step}: invalid value for '${c.param}' — pick from the list.`,
    ),
  COND_NESTING: (c) =>
    M(
      `${c.step}: điều kiện lồng quá một cấp — gộp các điều kiện về tối đa một nhóm.`,
      `${c.step}: conditions nest more than one level — flatten them.`,
    ),
  SYSTEM_TOOL_MISSING: (c) =>
    M(
      `Thiếu bước hệ thống '${c.param}' — mở lại quy trình trong trình sửa và lưu để tạo lại.`,
      `Missing system step '${c.param}' — reopen and save the process to rebuild it.`,
    ),
  UNREACHABLE_STEP: (c) =>
    M(
      `${c.step}: điều kiện của bước không bao giờ đúng nên bước này không chạy — sửa hoặc xoá điều kiện.`,
      `${c.step}: the condition can never hold so the step never runs — fix or remove it.`,
    ),
};

/** `steps.2.when` ⇒ bước 3, trường `when`; `stages.3.slot.when` (stage 1 = rẽ hệ thống) ⇒ bước 3. */
function locate(path: string): { step: number | null; field: string | null } {
  const s = /^steps\.(\d+)(?:\.(.+))?$/.exec(path);
  if (s) return { step: Number(s[1]) + 1, field: s[2] ?? null };
  const g = /^stages\.(\d+)(?:\.slot\.(.+))?$/.exec(path);
  if (g) {
    const j = Number(g[1]);
    return { step: j === 0 ? 1 : j, field: g[2] ?? null };
  }
  return { step: null, field: null };
}

export function explainIssue(i: PublishIssue): ExplainedIssue {
  const [code = i.rule, param = ""] = i.rule.split(/:(.*)/s);
  const { step, field } = locate(i.path);
  const f = RULES[code];
  const c: Ctx = { step: step === null ? "Quy trình" : `Bước ${step}`, field: field ?? "", param };
  const m = f
    ? f(c)
    : M(
        `${c.step}: không hợp lệ (${i.rule}) — sửa theo hướng dẫn rồi lưu lại.`,
        `${c.step}: invalid (${i.rule}) — fix and save again.`,
      );
  const en = step === null ? m.en : m.en.replace(/^Bước/, "Step");
  return { ...i, step, field, message: m.vi, message_en: en };
}

export const explainIssues = (xs: readonly PublishIssue[]): ExplainedIssue[] =>
  xs.map(explainIssue);

/** Gán: mã phòng ban `key` không có ở công ty `tenant` ⇒ một câu cho mỗi bước dùng mã (hoặc câu chung nếu không tìm ra bước). */
export function missingGroupIssues(
  body: unknown,
  tenant: string,
  keys: readonly string[],
): ExplainedIssue[] {
  const steps =
    typeof body === "object" && body !== null && Array.isArray((body as { steps?: unknown }).steps)
      ? ((body as { steps: unknown[] }).steps as unknown[])
      : [];
  return keys.flatMap((k) => {
    const hit = steps.flatMap((s, i) => (usesKey(s, k) ? [i] : []));
    const idx = hit.length ? hit : [null];
    return idx.map((i) => {
      const where = i === null ? "Quy trình" : `Bước ${i + 1}`;
      const whereEn = i === null ? "Process" : `Step ${i + 1}`;
      return {
        path: i === null ? "steps" : `steps.${i}`,
        rule: "GROUP_MISSING_IN_TENANT",
        step: i === null ? null : i + 1,
        field: "department_group_key",
        message: `${where}: phòng ban '${k}' không có ở công ty ${tenant} — tạo phòng ban này ở công ty hoặc đổi điều kiện/phòng ban của bước.`,
        message_en: `${whereEn}: department '${k}' does not exist in company ${tenant} — create it there or change the step.`,
      };
    });
  });
}

const usesKey = (x: unknown, k: string): boolean =>
  x === k ||
  (Array.isArray(x) && x.some((v) => usesKey(v, k))) ||
  (typeof x === "object" &&
    x !== null &&
    Object.entries(x).some(([p, v]) => p !== "key" && usesKey(v, k)));
