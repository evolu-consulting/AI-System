// CR-121 f16 · quy trình đang dùng của một việc là bản THƯ VIỆN (chỉ xem) hay bản RIÊNG của công ty (sửa được) — để ngăn việc luôn có MỘT nút
// mở trang chi tiết đúng nhãn. Không suy bản riêng từ lỗi cụ thể của API (mã lỗi có thể đổi): đọc xong mà không phải bản thư viện ⇒ bản riêng.
export type DefKind = "library" | "own" | "loading";

export type DefView = {
  kind: DefKind;
  /** Bản riêng mở sửa được: chính quy trình đang dùng (own) hoặc bản sao đã tạo từ bản thư viện (library có bản sao). */
  copyId: string | null;
  /** Mở trang chi tiết CHỈ XEM của bản thư viện đang dùng. */
  libraryId: string | null;
};

export function defView(p: {
  defId: string | null;
  library: { company_copy: { def_id: string } | null } | undefined;
  libraryPending: boolean;
}): DefView {
  if (!p.defId) return { kind: "loading", copyId: null, libraryId: null };
  if (p.library)
    return { kind: "library", copyId: p.library.company_copy?.def_id ?? null, libraryId: p.defId };
  if (p.libraryPending) return { kind: "loading", copyId: null, libraryId: null };
  return { kind: "own", copyId: p.defId, libraryId: null };
}

/** Lý do (nghiệp vụ) không vẽ được các bước + bước kế. */
export type StepsGap = "loadFail" | "noBody" | null;
export function stepsGap(p: { error: unknown; loaded: boolean; hasSteps: boolean }): StepsGap {
  if (p.error) return "loadFail";
  return p.loaded && !p.hasSteps ? "noBody" : null;
}
