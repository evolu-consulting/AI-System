// CR-125 · cr125-subprocess-ui · node "Quy trình con" (`core.subprocess`): một bước của quy trình cha CHẠY MỘT QUY TRÌNH KHÁC rồi quay lại.
// Hình đã thống nhất với lát engine (cr125-subprocess-engine): stage `{ node: "core.subprocess", executor: { kind: "subprocess", def_key, input_map? } }`,
// đầu ra "done" / "rejected" / "cancelled", kết quả `sub.<field>`. Hợp đồng (zod) do lát engine sở hữu; khi gộp, kiểu cục bộ dưới đây đổi sang
// kiểu của contract (xem tasks.md "Việc còn lại"). Thuần (không React) để test nhanh.
import type { ProcessDef, ProcessDefListItem } from "@ai/contracts/hub-admin";

export const SUBPROCESS_NODE = "core.subprocess";
export const SUBPROCESS_KIND = "subprocess";
/** Giá trị ô `executor` của bản nháp. */
export const SUBPROCESS_EXECUTOR = "subprocess";
/** Đầu ra của node, theo thứ tự hiện trên canvas (Xong · Từ chối · Huỷ). Nhãn: `process.admin.subprocess.exit.<key>`. */
export const SUBPROCESS_EXITS = ["done", "rejected", "cancelled"] as const;
export type SubprocessExit = (typeof SUBPROCESS_EXITS)[number];

/**
 * Đầu ra của ô trên canvas khi sổ MODULES (lát engine) chưa khai `exits` cho `core.subprocess`: Xong là đường đi tiếp; Từ chối / Huỷ là cổng có tên.
 * Khoá `on` chỉ để cổng có `handle` riêng (quy trình con không có stage chờ ⇒ chưa có cạnh nhánh — đích do engine quy định).
 */
export const SUBPROCESS_EXIT_DECL: readonly {
  key: SubprocessExit;
  label: { vi: string; en: string };
  on?: readonly string[];
}[] = [
  { key: "done", label: { vi: "Xong", en: "Done" } },
  { key: "rejected", label: { vi: "Từ chối", en: "Rejected" }, on: ["rejected"] },
  { key: "cancelled", label: { vi: "Huỷ", en: "Cancelled" }, on: ["cancelled"] },
];

/** Mã lỗi mà máy chủ trả khi lưu / chạy node này (khoá i18n `process.admin.apiError.<MÃ>`). */
export const SUBPROCESS_ERRORS = [
  "SUBPROCESS_NOT_FOUND",
  "SUBPROCESS_CYCLE",
  "SUBPROCESS_DEPTH",
] as const;
export type SubprocessError = (typeof SUBPROCESS_ERRORS)[number];

/** Kiểu cục bộ của executor (contract thật nằm ở lát engine; gộp xong thì thay bằng `Extract<…, { kind: "subprocess" }>`). */
export type SubprocessExecutor = {
  kind: typeof SUBPROCESS_KIND;
  def_key: string;
  input_map?: Record<string, string>;
};

/** Bản nháp: `defKey` rỗng = chưa chọn quy trình con; `inputMap`: đầu vào của quy trình con → nguồn ở quy trình cha. */
export type SubprocessDraft = { defKey: string; inputMap: Record<string, string> };

export const emptySubprocess = (): SubprocessDraft => ({ defKey: "", inputMap: {} });

export const isSubprocessNode = (node: string | undefined): boolean => node === SUBPROCESS_NODE;
export const isSubprocessExecutor = (executor: string): boolean => executor === SUBPROCESS_EXECUTOR;

export function subprocessFromDef(ex: SubprocessExecutor): SubprocessDraft {
  return { defKey: ex.def_key, inputMap: { ...(ex.input_map ?? {}) } };
}

/** Bản nháp → executor; ô ánh xạ trống bị bỏ, không có ánh xạ nào ⇒ không gửi `input_map`. */
export function subprocessToDef(d: SubprocessDraft | undefined): SubprocessExecutor {
  const map = Object.fromEntries(
    Object.entries(d?.inputMap ?? {}).filter(([k, v]) => k !== "" && v !== ""),
  );
  return {
    kind: SUBPROCESS_KIND,
    def_key: d?.defKey ?? "",
    ...(Object.keys(map).length > 0 ? { input_map: map } : {}),
  };
}

/** Đặt (hoặc bỏ, khi `source` rỗng) nguồn của một đầu vào quy trình con. */
export function withMapping(d: SubprocessDraft, input: string, source: string): SubprocessDraft {
  const next = { ...d.inputMap };
  if (source === "") delete next[input];
  else next[input] = source;
  return { ...d, inputMap: next };
}

/** Đổi quy trình con ⇒ ánh xạ cũ không còn nghĩa, xoá. */
export const withChild = (d: SubprocessDraft, defKey: string): SubprocessDraft =>
  d.defKey === defKey ? d : { defKey, inputMap: {} };

// ── danh sách chọn ───────────────────────────────────────────────────────────

export type ChildStatus = "published" | "enabled" | "draft";

/** Trạng thái hiện cạnh tên: Đã xuất bản (thư viện) · Đang bật (của công ty) · Nháp (chưa chọn được). */
export function childStatus(
  d: Pick<ProcessDefListItem, "enabled" | "published_version">,
): ChildStatus {
  if (d.published_version != null) return "published";
  return d.enabled ? "enabled" : "draft";
}

/** Chọn làm quy trình con được khi đã xuất bản hoặc đang bật. */
export const childPickable = (d: Pick<ProcessDefListItem, "enabled" | "published_version">) =>
  childStatus(d) !== "draft";

export type ChildOption = {
  key: string;
  id: string;
  name: string;
  status: ChildStatus;
  steps: number;
  disabled: boolean;
};

/**
 * Các quy trình có thể chọn làm con: cùng công ty (danh sách đã theo công ty), không phải chính nó (vòng tự gọi — máy chủ vẫn kiểm `SUBPROCESS_CYCLE`).
 * Nháp vẫn hiện nhưng không chọn được (cho người dùng biết vì sao thiếu).
 */
export function childOptions(
  defs: readonly ProcessDefListItem[],
  selfKey: string | undefined,
): ChildOption[] {
  return defs
    .filter((d) => d.key !== selfKey)
    .map((d) => ({
      key: d.key,
      id: d.id,
      name: d.name,
      status: childStatus(d),
      steps: d.stage_count,
      disabled: !childPickable(d),
    }))
    .sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.name.localeCompare(b.name, "vi"));
}

// ── đầu vào / kết quả của quy trình con ─────────────────────────────────────

export type ChildInput = { key: string; label: string; type: string; required: boolean };
export type ChildReturn = { key: string; label: string };

/** Quy trình con CẦN gì: các đầu vào khai báo của nó. */
export function childNeeds(def: Pick<ProcessDef, "inputs"> | undefined): ChildInput[] {
  return (def?.inputs ?? []).map((i) => ({
    key: i.key,
    label: i.label,
    type: i.type,
    required: i.required,
  }));
}

/**
 * Quy trình con TRẢ gì: các ô kết quả của form / bước của nó, ghi vào dữ liệu của cha dưới dạng `sub.<ô>` (engine). Trùng khoá chỉ kể một lần.
 */
export function childReturns(def: Pick<ProcessDef, "stages"> | undefined): ChildReturn[] {
  const out = new Map<string, ChildReturn>();
  for (const s of def?.stages ?? []) {
    const ex = s.executor as { kind: string; fields?: readonly { key: string; label?: string }[] };
    for (const f of [...(ex.kind === "form" ? (ex.fields ?? []) : []), ...s.output.fields]) {
      const label = "label" in f && typeof f.label === "string" && f.label !== "" ? f.label : f.key;
      if (!out.has(f.key)) out.set(f.key, { key: `sub.${f.key}`, label });
    }
  }
  return [...out.values()];
}

/** Đầu vào BẮT BUỘC của quy trình con mà chưa nối nguồn nào. */
export function unmappedRequired(needs: readonly ChildInput[], d: SubprocessDraft): ChildInput[] {
  return needs.filter((n) => n.required && !d.inputMap[n.key]);
}

/** Khoá lỗi hiện ở panel khi chưa chọn quy trình con (khớp luật lưu: `def_key` bắt buộc). */
export const subprocessMissing = (d: SubprocessDraft | undefined): boolean =>
  (d?.defKey ?? "") === "";

/** Mã lỗi quy trình con trong phản hồi lỗi → khoá i18n; mã khác ⇒ null. */
export const subprocessErrorKey = (code: string | null): string | null =>
  code !== null && (SUBPROCESS_ERRORS as readonly string[]).includes(code)
    ? `process.admin.apiError.${code}`
    : null;

/** Đường mở quy trình con trong trình sửa (cùng công ty ⇒ giữ `?company=` khi platform admin mở). */
export function childEditorLink(
  id: string,
  company: string | undefined,
): { to: "/processes/$processId"; params: { processId: string }; search: { company?: string } } {
  return {
    to: "/processes/$processId",
    params: { processId: id },
    search: company ? { company } : {},
  };
}
