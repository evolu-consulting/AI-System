// CR-126 · giá trị điền sẵn cho stage form BÊN TRONG node module (vd «Chọn đối tác & người nhận» của «Gửi đối tác xác nhận»): gói đăng ký
// theo KHOÁ NODE lúc mount; engine (`stepsView`) gọi cho bước form đang mở của cụm node đó và gắn `form.prefill` (hình `FormPrefill`,
// @ai/contracts/flow). Nằm ở kit vì gói cấm import `processes` (cùng khuôn `nodeConfigRegistry`). Resolver tự đọc dữ liệu gói bằng uow
// của gói (RLS gói), số câu cố định; lỗi ⇒ engine bỏ prefill (form vẫn nhập tay được), không làm vỡ thẻ.
import type { FormPrefill } from "@ai/contracts/flow";

export type FormPrefillQuery = {
  tenantId: string;
  /** Người xem (RLS gói). */
  userId: string;
  /** Bản ghi gói của lượt (`process_runs.pack_record_id`, vd id HĐ); null ⇒ không gắn bản ghi. */
  recordId: string | null;
};
export type FormPrefillResolver = (q: FormPrefillQuery) => Promise<FormPrefill>;

const resolvers = new Map<string, FormPrefillResolver>();

export const formPrefillRegistry = {
  /** Đăng ký lại cùng khoá ⇒ thay (mount chạy lại vô hại). */
  register(nodeKey: string, r: FormPrefillResolver): void {
    resolvers.set(nodeKey, r);
  },
  of(nodeKey: string | undefined): FormPrefillResolver | undefined {
    return nodeKey ? resolvers.get(nodeKey) : undefined;
  },
  /** Chỉ cho test. */
  clear(nodeKey: string): void {
    resolvers.delete(nodeKey);
  },
};
