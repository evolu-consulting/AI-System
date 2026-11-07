// CR-105 · L1 · design §2: registry KHE quy trình của app — ranh giới giữa thư viện quy trình (engine `processes/library`) và gói.
// Gói đăng ký khe lúc mount (vd `contracts.approval`); engine đọc spec để kiểm/biên dịch `slot_body` khi lưu/xuất bản (L2a) và
// không cần import gói (pack-boundary). Lớp 2 — chỉ kiểu + registry thuần (không I/O).

/** Vi phạm của `slot_body` (path theo body, rule = mã luật của khe). */
export type SlotIssue = { path: string; rule: string };

/** CR-121 D-0 · kiểu trường nghiệp vụ: số / một trong danh sách / phòng ban (tính cả phòng con) / có-không. */
export type SlotFieldType = "number" | "enum" | "department" | "boolean";
/** Toán tử điều kiện: so sánh số (`ge|gt|le|lt`), thuộc danh sách (`in`), bằng có/không (`is`). */
export type SlotFieldOp = "ge" | "gt" | "le" | "lt" | "in" | "is";
/**
 * CR-121 D-0 · trường nghiệp vụ app cho phép dùng trong điều kiện bước (trình sửa chỉ hiện các trường này). `key` = `field` của
 * điều kiện trong `slot_body`; nhãn tiếng Việt theo ngôn ngữ nghiệp vụ; `options` chỉ cho `enum` (giá trị + nhãn).
 */
export type SlotField = {
  key: string;
  label: string;
  type: SlotFieldType;
  ops: readonly SlotFieldOp[];
  options?: readonly { value: string; label: string }[];
};
/** CR-121 D-0 · loại node (bước) khe hỗ trợ — bằng đúng các tính năng/tool app đã có; trình sửa chỉ cho thêm các node này. */
export type SlotNodeKind = "review" | "dify" | "esign" | "notify" | "wait_until";
export type SlotNode = {
  kind: SlotNodeKind;
  label: string;
  /** Khoá icon của shell (admin-web tự ánh xạ sang icon). */
  icon: string;
};
/** Danh mục của khe (spec không khai ⇒ rỗng: khe không có điều kiện / node tuỳ biến). */
export const slotFields = (s: Pick<SlotSpec, "fields">): readonly SlotField[] => s.fields ?? [];
export const slotNodes = (s: Pick<SlotSpec, "nodes">): readonly SlotNode[] => s.nodes ?? [];

/** CR-121 D-2 · dữ kiện mẫu cho xem trước; trường vắng/null ⇒ "chưa có dữ liệu". `creatorDepartments` = mã phòng người gửi duyệt. */
export type SlotPreviewInput = {
  contractType?: string | null;
  value?: number | null;
  creatorDepartments?: readonly string[] | null;
  newPartner?: boolean | null;
};
export type SlotPreviewStep = {
  key: string;
  name: string;
  run: boolean;
  state: "run" | "skip" | "no_data";
};

/** @deprecated CR-122 · ADR-0038: thay bằng manifest `events[]` + `FactsReader`/`OutcomeHandler` (`flow-events.ports.ts`); gỡ ở R1. */
export type SlotSpec = {
  /** `<gói>.<việc>` — khớp CHECK `process_slots_slot_ck` (0068). */
  key: string;
  /** Nhãn hiển thị, vd "Sổ Hợp Tác · Duyệt hợp đồng". */
  label: string;
  packKey: string;
  /** CR-120 · true ⇒ khe CHỈ BẬT khi platform admin gán (opt-in): hub KHÔNG cấp luật mặc định (`ensureSlotDefaults`) và ops
   *  `flow_coverage` không đòi quy trình hiển thị. Vd 3 khe Community (duyệt bài tự bật cho mọi công ty là sai). */
  optIn?: boolean;
  /** CR-121 D-0 · trường nghiệp vụ dùng được trong điều kiện; vắng ⇒ rỗng (`slotFields`). */
  fields?: readonly SlotField[];
  /** CR-121 D-0 · danh mục node khe hỗ trợ; vắng ⇒ rỗng (`slotNodes`). */
  nodes?: readonly SlotNode[];
  /** Khoá input run bắt buộc (vd `contract_id`). */
  requiredInputs: readonly string[];
  /** Tool hệ thống mà def của khe phải có (nút khoá trên canvas). */
  systemTools: readonly string[];
  /** Kiểm hình + luật chéo bước của `slot_body` (Group theo MÃ; không kiểm theo tenant). Rỗng ⇒ hợp lệ. */
  validate(body: unknown): SlotIssue[];
  /** `slot_body` hợp lệ ⇒ `stages` def thư viện (Group theo `*_key`). Ném khi body sai (gọi `validate` trước). */
  compile(body: unknown): unknown[];
  /** Mã Group mà body tham chiếu (B2: kiểm Group theo tenant khi gán/xuất bản). */
  groupKeys(body: unknown): string[];
  /** Xem trước đường đi (không ghi): bước nào chạy / bị bỏ qua / chưa có dữ liệu với dữ kiện mẫu; body sai hình ⇒ null. */
  preview?(body: unknown, input: SlotPreviewInput): SlotPreviewStep[] | null;
  /** CR-105 · lưu từ canvas (chỉ `stages`): dựng lại `slot_body` theo mã; dạng khác (song song, If, nhánh) ⇒ `{stage}` sai đầu tiên. */
  fromStages?(stages: readonly unknown[]): { body: unknown } | { stage: string };
  /** CR-121 D-6 · input run mà stages của body cần (vd ngày HĐ cho Chờ tới, người phụ trách cho Thông báo) — gộp vào `inputs`
   *  của def thư viện khi lưu (thiếu khoá thì thêm, có rồi giữ). Vắng ⇒ không thêm. */
  inputs?(
    body: unknown,
  ): readonly { key: string; label: string; type: string; required: boolean }[];
};

export type SlotRegistry = {
  register(spec: SlotSpec): void;
  get(key: string): SlotSpec | undefined;
  list(): SlotSpec[];
};

export const SLOT_KEY_RE = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$/;

/** Registry trong bộ nhớ; đăng ký lại cùng khoá ⇒ thay (mount lại trong test). Khoá sai dạng ⇒ ném. */
export function createSlotRegistry(): SlotRegistry {
  const m = new Map<string, SlotSpec>();
  return {
    register(spec) {
      if (!SLOT_KEY_RE.test(spec.key)) throw new Error(`slot key không hợp lệ: ${spec.key}`);
      m.set(spec.key, spec);
    },
    get: (key) => m.get(key),
    list: () => [...m.values()],
  };
}

/** CR-105 · tra quy trình đang chạy của khe cho tenant: gán, không có ⇒ mặc định; bản xuất bản hiện hành. */
export type ResolvedSlot = {
  defId: string;
  name: string;
  relVersion: number;
  slotBody: unknown;
  /** CR-105 L4 · true ⇒ không có gán riêng, đang dùng mặc định của khe. */
  isDefault?: boolean;
};

/**
 * CR-118 §11.2 · kết quả chọn quy trình theo luật của tenant × khe cho người khởi tạo. `ruleId` = luật đã khớp (null ⇒ tenant chưa
 * có luật, dùng đường `resolveSlot` cũ). `blocked`: có luật mà không khớp + không mặc định (`route_none`) hoặc quy trình của luật
 * không còn bản xuất bản (`route_unavailable`) ⇒ gói chặn khởi tạo.
 */
export type RoutedSlot =
  | (ResolvedSlot & { ruleId: string | null })
  | { blocked: "route_none" | "route_unavailable"; ruleId: string | null };

/** cr118-route-kind · dữ kiện lượt khe gửi kèm `routeSlot`. `contractKind` vắng ⇒ khe không có loại HĐ (luật bỏ qua điều kiện
 *  loại); `null` ⇒ HĐ chưa có loại (luật có điều kiện loại không khớp). */
export type RouteSlotFacts = { contractKind?: string | null };
