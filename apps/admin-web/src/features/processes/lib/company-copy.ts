// CR-121 c17b · nhận diện bản RIÊNG của công ty (sao từ thư viện) và nhãn hồ sơ của lượt chạy. Logic thuần.
type DefLike = { source_template_id?: string | null; slot_body?: unknown };

/** Bản riêng = có nguồn thư viện và không phải editor thư viện (platform); sửa thẳng, không Xuất bản. */
export const isCompanyCopy = (def: DefLike | undefined, lib: unknown): boolean =>
  !!def?.source_template_id && !lib;

/** Bản riêng DÙNG ĐƯỢC Form bước dọc chung ⇔ Hub trả `slot_body` (bản sao cũ chưa có body ⇒ chỉ Sơ đồ). */
export const usesStepForm = <D extends DefLike>(def: D | undefined, lib: unknown): D | null =>
  def && isCompanyCopy(def, lib) && def.slot_body != null ? def : null;

/** Nhãn hồ sơ của lượt chạy: mã HĐ thật, hoặc "—" khi lượt không gắn hồ sơ. */
export const recordLabelOf = (r: { record_label?: string | null }): string => r.record_label ?? "—";
