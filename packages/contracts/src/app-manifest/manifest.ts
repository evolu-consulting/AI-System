// CR-118 · cr118-app-config · manifest DỮ LIỆU của một app (chỉ dữ liệu, không code): mục menu, hành động chính, khe quy trình,
// feature cần có. Một nguồn cho trang cấu hình app của ai-admin (xem trước "công ty thấy gì") và shell web gộp (dựng menu).
// Tên hiển thị tiếng Việt viết thẳng (`label`) để xem trước không phụ thuộc bản dịch của web nào; web gộp dùng `labelKey`.
import type { FlowStepKind } from "../flow/view";

/** Mức dùng app của công ty (feature `<app>-read|write|admin`, cộng dồn). */
export const APP_LEVELS = ["read", "write", "admin"] as const;
export type AppAccessLevel = (typeof APP_LEVELS)[number];

/** Ba vai xem trước: quản trị công ty · thành viên · đối tác (công ty ngoài). */
export const PREVIEW_ROLES = ["company_admin", "member", "partner"] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];

/** Điều kiện để thấy/mở một mục: mức tối thiểu của công ty, feature thêm, người nào được thấy. */
export type AppGate = {
  /** Mức tối thiểu của công ty đối với app. */
  level: AppAccessLevel;
  /** Feature thêm (tính năng bán riêng) bắt buộc phải bật. */
  addon?: string;
  /** `company_admin`: chỉ quản trị công ty. Mặc định mọi thành viên. */
  audience?: "everyone" | "company_admin";
  /** Đối tác (công ty ngoài) có được thấy không. Mặc định: không bao giờ. */
  partner?: boolean;
};

export type AppNavItem = AppGate & {
  key: string;
  /** Khoá i18n của web gộp. */
  labelKey: string;
  /** Tên tiếng Việt cho xem trước. */
  label: string;
  /** Hành động chính mở được ở màn này (câu ngắn, không thuật ngữ). */
  actions?: readonly AppAction[];
};

export type AppAction = AppGate & { key: string; label: string };

/**
 * Khe quy trình của app (điểm cắm một quy trình thư viện cho từng công ty). CR-120 §2 · ADR-0036: mọi app khai báo ≥ 1 khe, và ≥ 1 khe
 * LUÔN BẬT (`required` + không `addon`) — kiểm bằng `bun run check:app-slots` (`appSlotIssues`).
 * @deprecated CR-122 · ADR-0038: thay bằng `AppManifest.events` (`AppEventDecl`); giữ tới lát R1 (gỡ khe + `check:app-slots`).
 */
export type AppSlotDecl = {
  /** `<app>.<việc>` — khớp CHECK `process_slots_slot_ck` (hub 0068) và tiền tố = `AppManifest.key`. */
  key: string;
  label: string;
  /** Mức tối thiểu để khe chạy. */
  level: AppAccessLevel;
  /** Feature thêm bắt buộc để khe chạy (thiếu ⇒ app dùng cách duyệt mặc định cũ). */
  addon?: string;
  /** Câu ngắn (≤ 200) nói khe làm gì — hiện ở admin /apps và Cài đặt › Ứng dụng & quy trình. */
  purpose: string;
  /** Mặc định true: thuộc bất biến FLOW-FR-05 (tenant bật app ⇒ khe có def hiệu lực). */
  required?: boolean;
  /** Key def thư viện (`tenant_id null`, dạng `ProcessKey`) = `process_slots.default_def_id`; seed bằng migration hub. */
  defaultDefKey: string;
  /** Loại bước editor cho phép ở khe (≥ 1, trong `FLOW_STEP_KINDS`). */
  allowedKinds: readonly FlowStepKind[];
  /** Sự kiện mở lượt (≤ 120, vd `post.created`) — chỉ hiển thị. */
  trigger: string;
};

export const SLOT_PURPOSE_MAX = 200;
export const SLOT_TRIGGER_MAX = 120;

/** Khe thuộc bất biến (mặc định bắt buộc). */
export const slotRequired = (s: Pick<AppSlotDecl, "required">): boolean => s.required !== false;
/** Khe luôn bật: bắt buộc và không cần add-on. */
export const slotAlwaysOn = (s: Pick<AppSlotDecl, "required" | "addon">): boolean =>
  slotRequired(s) && !s.addon;

export type AppManifest = {
  key: string;
  name: string;
  /** Feature từng mức (mức chọn được = mọi mức thấp hơn đều có feature). */
  levelFeatures: Readonly<Record<AppAccessLevel, string>>;
  /** Feature thêm của app, kèm tên dễ hiểu (xem trước giải thích lý do ẩn). */
  addons: readonly { key: string; label: string }[];
  nav: readonly AppNavItem[];
  /** @deprecated CR-122 · thay bằng `events`; gỡ ở R1. */
  slots: readonly AppSlotDecl[];
  /** CR-122 · FLOW2-FR-17/18 · sự kiện làm flow chạy (node Bắt đầu khi); luật ở `appEventIssues` (`check:app-events`). */
  events: readonly AppEventDecl[];
};

// ── CR-122 · ADR-0038 · flow-model.md mục C: sự kiện app (thay `AppSlotDecl`) ─────────────────────────────────────────────

/** Kiểu dữ kiện (trường nghiệp vụ của bản ghi mà flow đọc được) — điều kiện Bắt đầu khi / Nếu so sánh theo kiểu này. */
export const APP_FACT_TYPES = [
  "number",
  "string",
  "enum",
  "department",
  "boolean",
  "date",
] as const;
export type AppFactType = (typeof APP_FACT_TYPES)[number];
export type AppFactDecl = {
  /** `snake_case` (khớp `FACT_KEY_RE`) — khoá `fact` trong điều kiện của FlowDef và trong kết quả `FactsReader`. */
  key: string;
  label: string;
  type: AppFactType;
  /** Chỉ cho `enum`: giá trị + nhãn. */
  options?: readonly { value: string; label: string }[];
};
/** Kết quả node Kết thúc mà app xử lý (`OutcomeHandler`); `effect` = câu "app sẽ làm gì" hiện trên node. */
export type AppOutcomeDecl = { key: string; label: string; effect: string };
export type AppEventDecl = {
  /** `<thực thể>.<việc>` (khớp `FLOW_EVENT_KEY_RE`), vd `contract.submitted`; duy nhất trên mọi app. */
  key: string;
  /** Nhãn trên node Bắt đầu khi, vd "Khi gửi duyệt HĐ". */
  label: string;
  facts: readonly AppFactDecl[];
  /** ≥ 1 — node Kết thúc của flow theo sự kiện này chỉ chọn trong danh sách này. */
  outcomes: readonly AppOutcomeDecl[];
  /** true ⇒ kết quả đổi trạng thái bản ghi: mỗi bản ghi chỉ MỘT lượt — flow khớp đầu tiên theo `position` (H1). */
  decides: boolean;
  /** true ⇒ công ty bật app phải có ≥ 1 flow đang bật không điều kiện cho sự kiện này (lưới cuối). */
  required: boolean;
  /** Khoá flow Thư viện mặc định (dạng `ProcessKey`); bắt buộc khi `required` (thiếu ⇒ `check:app-events` cảnh báo). */
  defaultFlowKey?: string;
};

export const EVENT_LABEL_MAX = 120;
export const EVENT_FACTS_MAX = 20;
export const EVENT_OUTCOMES_MAX = 6;
/** `<thực thể>.<việc>` — chữ thường, `_`/`-` trong từng phần. */
export const FLOW_EVENT_KEY_RE = /^[a-z][a-z0-9_-]{0,39}\.[a-z][a-z0-9_-]{0,39}$/;
/** Khoá dữ kiện / kết quả: snake_case. */
export const FACT_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const OUTCOME_KEY_RE = FACT_KEY_RE;
