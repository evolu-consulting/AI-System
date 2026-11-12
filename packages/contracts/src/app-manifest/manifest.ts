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
  /** CR-125 · tín hiệu CHỈ để node chờ (`wait_event`) — không phải sự kiện bắt đầu flow: không có dữ kiện/kết quả, không vào "Bắt đầu khi". */
  signals?: readonly AppSignalDecl[];
  /** CR-122 · FLOW2-FR-25 · node của app trên bảng node (executor có sẵn + cấu hình đặt sẵn); luật ở `appNodeIssues`. */
  nodes: readonly AppNodeDecl[];
};

// ── CR-122 · FLOW2-FR-25/26 · node của module tính năng (KHÔNG executor mới — chỉ cấu hình đặt sẵn của executor có) ──────────

/** `<app|core>.<node>`, vd `core.email`, `contracts.esign`. */
export const APP_NODE_KEY_RE = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$/;
/** Executor có sẵn mà node module được dùng (khớp `executor.kind` của `ProcessStageDefSchema`). */
export const NODE_EXECUTORS = [
  "notify",
  "wait_until",
  "wait_for",
  "wait_event",
  "tool",
  "set",
  "subprocess", // CR-125 · Quy trình con
  "form", // CR-126 · bước người điền bên trong node (vd «Chọn đối tác & người nhận»); nhóm làm = `assignee_group` của node
] as const;
export type NodeExecutor = (typeof NODE_EXECUTORS)[number];
/** Nhóm trên bảng node. */
export const NODE_GROUPS = ["message", "timing", "sign", "content", "partner", "people"] as const;
export type NodeGroup = (typeof NODE_GROUPS)[number];
export const NODE_STAGES_MAX = 3;
export const NODE_IO_MAX = 20;

/** Một cổng vào/ra của node (FR-26): khoá snake_case + kiểu dữ kiện sẵn có. */
export type AppNodeIo = {
  key: string;
  type: AppFactType;
  required: boolean;
  /** CR-122 · A · nhãn nghiệp vụ (UI ghi "Bước «Gửi ký số» cần «Hợp đồng»"); vắng ⇒ dùng `key`. */
  label?: { vi: string; en: string };
  /** CR-125 m4 · cách khắc phục khi đầu vào bắt buộc không có nguồn (vd "thêm bước Tải hợp đồng trước"). */
  fix?: { vi: string; en: string };
  /**
   * CR-125 · m8 · CHỈ đầu ra: đã khai (cổng đủ, nhãn nghiệp vụ) nhưng máy chủ CHƯA ghi giá trị này vào dữ liệu lượt chạy ⇒ không được dùng
   * làm nguồn tự nối (`autoMapInputs`, cạnh flow). Bỏ cờ khi binding của node khai ghi được (`NodeBinding.outputs`). Sổ module kiểm hai chiều.
   */
  pending?: boolean;
};
/** Nhãn hai thứ tiếng của một đầu vào/ra; vắng ⇒ khoá. */
export const ioLabel = (io: { key: string; label?: { vi: string; en: string } }) =>
  io.label ?? { vi: io.key, en: io.key };
/** Một stage mẫu của node: executor có sẵn + cấu hình đặt sẵn; `outcome` ⇒ node Kết thúc. */
export type AppNodeStage = {
  executor: { kind: NodeExecutor } & Readonly<Record<string, unknown>>;
  outcome?: string;
  real_action?: boolean;
};
/** CR-123 · FLOW3-FR-14 · một đầu ra nghiệp vụ của node nhiều stage (ô duy nhất trên sơ đồ). `on` vắng ⇒ đường thành công (đi tiếp
 *  bước kế); có `on` ⇒ khoá sự kiện / `timeout` của stage chờ (`wait_event.branches[].on`) gom về đầu ra này. */
export type AppNodeExit = {
  key: string;
  label: { vi: string; en: string };
  on?: readonly string[];
};
/**
 * CR-125 · m5 · tiền điều kiện node KHAI BÁO (nguồn duy nhất của luật "hành động thật cần người duyệt ngay trước", `process-real-rule.ts`):
 * `before: "approval"` ⇒ stage hành động thật của node chỉ hợp lệ khi MỌI stage của bước liền trước là bước duyệt. Vắng ⇒ không đòi gì.
 */
export type NodeRequires = { before: "approval" };

/**
 * CR-125 · m6b · vị trí của node trên menu "+" / bảng node (MỘT nguồn, không danh sách cứng ở web): `business` = bước nghiệp vụ mọi người thấy,
 * `advanced` = "Nâng cao" (chỉ quản trị nền tảng); trong nhóm xếp theo `order` tăng dần (mặc định 50). Vắng `menu` ⇒ `advanced`.
 */
export type NodeMenu = { section: "business" | "advanced"; order?: number };
export const NODE_MENU_ORDER_DEFAULT = 50;

export type AppNodeDecl = {
  key: string;
  menu?: NodeMenu;
  /** CR-125 · m5 · tiền điều kiện của node (xem `NodeRequires`); picker, kéo thả, nối lại và lưu cùng đọc từ đây qua `MODULES`. */
  requires?: NodeRequires;
  label: { vi: string; en: string };
  group: NodeGroup;
  /** 1..3 stage mẫu chèn vào flow (vd Ký số = tool gửi ký + chờ sự kiện ký). */
  stages: readonly AppNodeStage[];
  /** Khoá tính năng (danh mục CR-111) phải bật cho công ty; vắng = luôn có (node lõi). */
  feature?: string;
  /** CR-122 · E5 · node có cấu hình riêng: panel ghi vào `args` của stage `stage` (chỉ số trong `stages`) và lấy lựa chọn từ
   *  `options_path` (`/pack/<app>/…`, GET). Vắng ⇒ node không có cấu hình. */
  config?: { stage: number; options_path: string };
  /** CR-123 · FLOW3-FR-14 · đầu ra theo kết quả nghiệp vụ hiện trên ô node (vắng ⇒ một đầu ra "đi tiếp"). */
  exits?: readonly AppNodeExit[];
  inputs: readonly AppNodeIo[];
  outputs: readonly AppNodeIo[];
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
  /** Nhãn tiếng Việt; `label_en` vắng ⇒ dùng `label`. */
  label: string;
  label_en?: string;
  type: AppFactType;
  /** Chỉ cho `enum`: giá trị + nhãn. */
  options?: readonly { value: string; label: string }[];
};
/** Kết quả node Kết thúc mà app xử lý (`OutcomeHandler`); `effect` = câu "app sẽ làm gì" hiện trên node. */
export type AppOutcomeDecl = { key: string; label: string; effect: string };
/** CR-125 · tín hiệu chờ của app (vd `esign.completed`): `<thực thể>.<việc>` như sự kiện nhưng chỉ node chờ dùng. */
/** `pick` (CR-125 · m6b): tín hiệu hiện trong ô chọn của bước "Chờ sự kiện" cho người dùng công ty (không phải gõ khoá). */
export type AppSignalDecl = { key: string; label: string; pick?: boolean };
export type AppEventDecl = {
  /** `<thực thể>.<việc>` (khớp `FLOW_EVENT_KEY_RE`), vd `contract.submitted`; duy nhất trên mọi app. */
  key: string;
  /** Nhãn trên node Bắt đầu khi, vd "Khi gửi duyệt HĐ". */
  label: string;
  /**
   * CR-122 · A · bản ghi mà sự kiện nói tới (= `ref` của sự kiện), vd HĐ ⇒ `contract_id`. Đầu ra của node Bắt đầu khi (cùng mọi
   * `facts`) — có ở MỌI bước sau, node cần khoá này (vd Ký số cần `contract_id`) tự nhận, không cần cầu nối.
   */
  record?: { key: string; label: { vi: string; en: string } };
  facts: readonly AppFactDecl[];
  /** ≥ 1 — node Kết thúc của flow theo sự kiện này chỉ chọn trong danh sách này. */
  outcomes: readonly AppOutcomeDecl[];
  /** true ⇒ kết quả đổi trạng thái bản ghi: mỗi bản ghi chỉ MỘT lượt — flow khớp đầu tiên theo `position` (H1). */
  decides: boolean;
  /** true ⇒ công ty bật app phải có ≥ 1 flow đang bật không điều kiện cho sự kiện này (lưới cuối). */
  required: boolean;
  /** Khoá flow Thư viện mặc định (dạng `ProcessKey`); bắt buộc khi `required` (thiếu ⇒ `check:app-events` cảnh báo). */
  defaultFlowKey?: string;
  /**
   * CR-127 · E1 · sự kiện THEO LỊCH (vòng `schedule-sweep`, E6): flow chọn N ngày (`trigger.params.days`); facts của sự kiện có `days = N`.
   * Sự kiện không có `schedule` do app phát (không theo lịch).
   */
  schedule?: AppEventSchedule;
};
/** Tham số duy nhất của sự kiện theo lịch: N ngày (khoá `days`, `min..max`, mặc định `default`). */
export type AppEventSchedule = {
  param: { key: "days"; min: number; max: number; default: number };
};
export const SCHEDULE_DAYS_MIN = 1;
export const SCHEDULE_DAYS_MAX = 365;

export const EVENT_LABEL_MAX = 120;
export const EVENT_FACTS_MAX = 20;
export const EVENT_OUTCOMES_MAX = 6;
/** `<thực thể>.<việc>` — chữ thường, `_`/`-` trong từng phần. */
export const FLOW_EVENT_KEY_RE = /^[a-z][a-z0-9_-]{0,39}\.[a-z][a-z0-9_-]{0,39}$/;
/** Khoá dữ kiện / kết quả: snake_case. */
export const FACT_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const OUTCOME_KEY_RE = FACT_KEY_RE;
