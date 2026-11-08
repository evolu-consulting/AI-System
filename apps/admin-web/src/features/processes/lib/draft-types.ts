// ADM-FR-66 · CR-056 · P-a F5 · P-d1: kiểu bản nháp của editor quy trình (tách khỏi `def-form` để các module `*-form` không import vòng).
// Chỉ kiểu — không giá trị; `def-form` re-export cho nơi dùng cũ.
import type { FormFieldType, LayoutDir, ProcessStageDef, SetAs } from "@ai/contracts/hub-admin";
import type { AutofixDraft } from "./autofix-form";
import type { ParallelDraft } from "./parallel-form";
import type { InputDraft, StageSourceDraft } from "./sources-form";
import type { StartFormDraft } from "./start-form.types";

/** P-d1 · khối "Chờ tới ngày": nguồn ngày (`input:<key>` | `field:<stage_key>:<field>`), chênh (ngày, chữ), giờ `HH:mm`. */
export type WaitDraft = {
  source: string;
  offset: string;
  time: string;
  /** CR-120 · G3 · `wait_for`: số giờ chờ (chữ). */
  hours?: string;
  /** CR-120 · G4 · `wait_event`: khoá sự kiện + hạn (giờ, chữ). */
  event?: string;
  timeoutH?: string;
  /** CR-122 · U2b · `wait_event.branches`: mỗi kết quả (khoá sự kiện / `timeout`) → bước đích (0-based, null = chưa chọn). */
  branches?: { on: string; step: number | null }[];
  /** Sự kiện phụ cũng kết thúc chờ (`also_events`, ≤ 3) — giữ nguyên khi lưu. */
  also?: string[];
};
export type EscalateDraft = { on: boolean; afterH: string; groupId: string };

/** P-d2 · nguồn một tham số tool: `from` rỗng = chưa chọn; `value` = giá trị cố định | khoá input | `<stage_key>:<field>`. */
export type ArgDraft = {
  from: "" | "const" | "input" | "field";
  value: string;
  /** Kiểu JS của giá trị cố định khi gửi (`number`/`boolean` theo kiểu tham số). */
  kind: "string" | "number" | "boolean";
};
/** P-d2 · khối "Gọi tool": `key` rỗng = chưa chọn tool; `args` theo tên tham số. */
export type ToolDraft = { key: string; args: Record<string, ArgDraft> };
/** CR-103 · R4 · một dòng gán của node `set`: `source` chọn nguồn; `value` = hằng (chuỗi, ép số khi gửi). */
export type SetRowDraft = {
  key: string;
  source: "input" | "const" | "field" | "fact";
  input: string;
  value: string;
  /** CR-122 E4/U2c · `field`: bước trước (0-based, null = chưa chọn); khoá field ở `ref`. `fact`: khoá dữ kiện ở `ref`. */
  step: number | null;
  ref: string;
  /** Biến đổi kiểu khi ghi ("" = giữ nguyên). */
  as: "" | SetAs;
};
export type SetDraft = { rows: SetRowDraft[] };
/** P-d2 · một luật rẽ nhánh; `goto` đếm bước từ 1 như UI (`goto_step = goto - 1`), null = chưa chọn. */
export type BranchDraft = { field: string; op: string; value: string; goto: number | null };

/** Nguồn một điều kiện: `field|<stage_key>|<field>` hoặc `input|<key>`; rỗng = chưa chọn. */
/** `type` = kiểu nguồn đã chọn (Số ⇒ giá trị gửi là number). */
/** `type` "boolean" ⇒ vế Có/Không của dữ kiện: giá trị UI "true"/"false" nhưng GỬI boolean thật (một dạng, như "Bắt đầu khi"). */
export type CondDraft = {
  from: string;
  type: FieldDraft["type"] | "boolean";
  op: string;
  value: string;
};
export type IfDraft = {
  op: "and" | "or";
  conds: CondDraft[];
  /** Bước Đúng (`yes`) / Sai (`no`) đếm từ 1; `no = null` ⇒ Sai thì sang bước kế; `yes = null` = chưa chọn. */
  yes: number | null;
  no: number | null;
};
/** CR-118 · một lựa chọn của trường `select`. */
export type FormOptionDraft = { value: string; label: string };
/**
 * CR-118 · một trường form ở dạng nhập tay (chuỗi như các draft khác): giới hạn là chuỗi, chuyển sang `FormField` khi gửi.
 * `keyAuto` = mã còn tự sinh từ nhãn (người dùng chưa sửa tay).
 */
export type FormFieldDraft = {
  type: FormFieldType;
  key: string;
  keyAuto: boolean;
  label: string;
  help: string;
  required: boolean;
  /** text / textarea: độ dài tối đa. */
  maxLen: string;
  /** number / money: nhỏ nhất, lớn nhất (rỗng = không giới hạn; money rỗng = 0). */
  min: string;
  max: string;
  /** number: chỉ nhận số nguyên. */
  integer: boolean;
  /** select. */
  options: FormOptionDraft[];
};
export type FieldDraft = { key: string; type: "number" | "string" | "date"; required: boolean };
export type StageDraft = {
  /** Khoá React cục bộ (không gửi đi). */
  uid: string;
  /** Mã giai đoạn còn tự sinh từ tên (người dùng chưa sửa tay). */
  keyAuto: boolean;
  key: string;
  name: string;
  /** `agent:<id>` | `team:<id>` | "" (chưa chọn). */
  executor: string;
  instruction: string;
  filename: string;
  template: string;
  sections: string[];
  fields: FieldDraft[];
  after: "review" | "auto";
  /** P-b2 · bước 0-based (UI hiển thị `step+1`); mảng stage luôn không giảm theo `step`, liên tục từ 0. */
  step: number;
  /** P-b2 · bước được phép quay lại khi Chưa đạt (< `step`); chỉ có nghĩa khi `after = review`. */
  backTo: number[];
  groupId: string;
  /** Mẫu Thư viện (tenant NULL) chọn nhóm theo MÃ (fter.group_key), không id; có mã ⇒ groupId rỗng. */
  groupKey?: string;
  real: boolean;
  answerer: "starter" | "group" | "user";
  answererId: string;
  timeout: string;
  budget: string;
  /** Nguồn dùng + allowlist (textarea) — `sources-form`. */
  sources: StageSourceDraft[];
  /** `must_know`, mỗi dòng một mục. */
  mustKnow: string;
  /** P-c1 · khối "Tự sửa mã" (tắt ⇒ `autofix: null`, giữ giá trị đã nhập). */
  autofix: AutofixDraft;
  /** P-d1 · khối "Chờ tới ngày" (chỉ có nghĩa khi `executor = wait_until`). */
  wait: WaitDraft;
  /** P-d1 · "Nhắc mỗi (giờ)" — rỗng = `remind_every_h: null`; chỉ có nghĩa khi `after = review`. */
  remind: string;
  /** P-d1 · "Chuyển cấp nếu chưa ai kiểm" (tắt ⇒ `escalate: null`, giữ giá trị đã nhập). */
  /** N2-FR-05 · "Người bắt đầu không được duyệt bước này" (`after.exclude_starter`); vắng = false. */
  excludeStarter?: boolean;
  escalate: EscalateDraft;
  /** P-d2 · khối "Gọi tool" (chỉ có nghĩa khi `executor = tool`). */
  tool: ToolDraft;
  /** CR-103 · R4 · khối "Ghi giá trị" (chỉ có nghĩa khi `executor = set`). */
  set: SetDraft;
  /** P-d2 · luật rẽ nhánh (`after.branch`, cả review lẫn auto); mặc định `[]`. */
  branch: BranchDraft[];
  /** CR-103 · fnr-if · khối "Nếu" (chỉ dùng khi `executor = "if"`). */
  ifx: IfDraft;
  /** CR-118 · trường của node `form` (chỉ có nghĩa khi `executor = form`); `fields` (output) luôn đồng bộ theo đây. */
  formFields?: FormFieldDraft[];
  /** CR-105 · `stage.slot` của khe (mô tả bước người dùng: review/Dify, hoặc `esign` ở finalize) — giữ nguyên qua Canvas, Hub `fromStages` dựng lại `slot_body`. */
  slotRaw?: Record<string, unknown> | undefined;
  /** CR-122 · U2 · executor `notify` đã có cấu hình (node bảng Gửi email / Thông báo chuông) — giữ nguyên khi lưu. */
  notifyRaw?: Extract<ProcessStageDef["executor"], { kind: "notify" }>;
  /** CR-122 · U2 · khoá node bảng (`core.email`, `contracts.esign`…) đã chèn stage này; ghi vào `stage.node`. */
  node?: string;
  /** CR-122 · U2 · node Duyệt: bước (0-based, sau bước mình) khi Từ chối / Trả lại; null = hành vi cổng cũ. */
  approve?: { reject: number | null; ret: number | null };
  /** CR-125 · cr125-parallel-approval-ui · «A + B cùng duyệt» (`after.parallel`; chỉ bước Duyệt). Vắng = một nhóm duyệt như cũ (`groupId`). */
  parallel?: ParallelDraft;
  /** CR-125 · cr125-subprocess-ui · khối "Quy trình con" (chỉ có nghĩa khi `executor = subprocess`). */
  subprocess?: { defKey: string; inputMap: Record<string, string> };
  /** CR-122 · node Kết thúc: khoá kết quả app khai (`AppEventDecl.outcomes`); vắng = không phải Kết thúc. */
  outcome?: string;
  /** CR-122 · bước gộp (0-based, > bước của mình); vắng = đi tiếp bước kế. */
  nextStep?: number;
  /** CR-103 · fnr-canvas · `y` đã lưu của node trên canvas (`ui.y`, chỉ-UI); vắng = bố cục tự động. */
  uiY?: number;
  /** CR-123 · u13 · `x` đã lưu (`ui.x`) — chỉ cùng với `uiY` mới là vị trí kéo tay; vắng = bố cục ELK. */
  uiX?: number;
  /** CR-125 · cr125-manual-start-ui · phiếu yêu cầu của node «Bắt đầu bằng phiếu» (`stage.start_form`); chỉ có ở stage `node = core.start-form`. */
  startForm?: StartFormDraft;
  /** CR-125 · x9 · hướng bố cục của CẢ flow (`ui.dir`): ghi trên mọi giai đoạn, đọc từ giai đoạn đầu có giá trị (`layoutDirOf`). */
  uiDir?: LayoutDir;
  /** CR-123 · u5 · node mới thả từ menu/bảng mẫu đứng RIÊNG: chưa nối vào đâu cho tới khi kéo mũi tên tới nó. Chỉ ở bản nháp (không gửi Hub); Lưu bị chặn khi còn. */
  free?: boolean;
};
export type DefDraft = {
  key: string;
  name: string;
  description: string;
  hint: string;
  groupIds: string[];
  budget: string;
  enabled: boolean;
  stages: StageDraft[];
  /** Khoá nguồn của quy trình (≤ 20). */
  sources: string[];
  inputs: InputDraft[];
  /** P-d1 · "Thời hạn lượt chạy (ngày)" (chữ) + "Không hết hạn" ⇒ `ttl_days: null`. */
  ttl: string;
  noExpiry: boolean;
};
/** path (`stages.0.output.filename`) → khoá i18n của câu lỗi. */
export type DraftErrors = Record<string, string>;
