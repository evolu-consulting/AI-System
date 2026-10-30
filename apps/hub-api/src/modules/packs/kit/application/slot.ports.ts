// CR-105 · L1 · design §2: registry KHE quy trình của app — ranh giới giữa thư viện quy trình (engine `processes/library`) và gói.
// Gói đăng ký khe lúc mount (vd `contracts.approval`); engine đọc spec để kiểm/biên dịch `slot_body` khi lưu/xuất bản (L2a) và
// không cần import gói (pack-boundary). Lớp 2 — chỉ kiểu + registry thuần (không I/O).

/** Vi phạm của `slot_body` (path theo body, rule = mã luật của khe). */
export type SlotIssue = { path: string; rule: string };

export type SlotSpec = {
  /** `<gói>.<việc>` — khớp CHECK `process_slots_slot_ck` (0068). */
  key: string;
  /** Nhãn hiển thị, vd "Sổ Hợp Tác · Duyệt hợp đồng". */
  label: string;
  packKey: string;
  /** Khoá input run bắt buộc (vd `contract-id`). */
  requiredInputs: readonly string[];
  /** Tool hệ thống mà def của khe phải có (nút khoá trên canvas). */
  systemTools: readonly string[];
  /** Kiểm hình + luật chéo bước của `slot_body` (Group theo MÃ; không kiểm theo tenant). Rỗng ⇒ hợp lệ. */
  validate(body: unknown): SlotIssue[];
  /** `slot_body` hợp lệ ⇒ `stages` def thư viện (Group theo `*_key`). Ném khi body sai (gọi `validate` trước). */
  compile(body: unknown): unknown[];
  /** Mã Group mà body tham chiếu (B2: kiểm Group theo tenant khi gán/xuất bản). */
  groupKeys(body: unknown): string[];
  /** Xem trước đường đi (không ghi): bước nào chạy / bị bỏ qua với (loại HĐ, giá trị); body sai hình ⇒ null. */
  preview?(
    body: unknown,
    input: { contractType: string; value: number },
  ): { key: string; name: string; run: boolean }[] | null;
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
};
