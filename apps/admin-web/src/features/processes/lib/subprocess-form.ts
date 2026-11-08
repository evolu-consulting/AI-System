// CR-125 · cr125-subprocess-ui · node "Quy trình con" (`core.subprocess`): một bước của quy trình cha CHẠY MỘT QUY TRÌNH KHÁC rồi quay lại.
// Hình chốt với lát engine: stage `{ node: "core.subprocess", executor: { kind: "subprocess", def_key, input_map?, branches? } }`; đầu ra done /
// rejected / cancelled (rejected + cancelled rẽ theo `branches`, done đi bước kế); kết quả `outcome` + `sub_<trường>`. Thuần (không React).
import type { CompanyFlowRow, ProcessDef, SubprocessExecutor } from "@ai/contracts/hub-admin";
import { SUBPROCESS_FIELD_PREFIX } from "@ai/contracts/hub-admin";
import type { WaitDraft } from "./draft-types";
import { emptyWait } from "./wait-form";

export const SUBPROCESS_NODE = "core.subprocess";
export const SUBPROCESS_KIND = "subprocess";
/** Giá trị ô `executor` của bản nháp. */
export const SUBPROCESS_EXECUTOR = "subprocess";

/** Mã lỗi mà máy chủ trả khi lưu node này (khoá i18n `process.admin.apiError.<MÃ>`). */
export const SUBPROCESS_ERRORS = [
  "SUBPROCESS_NOT_FOUND",
  "SUBPROCESS_CYCLE",
  "SUBPROCESS_DEPTH",
] as const;
export type SubprocessError = (typeof SUBPROCESS_ERRORS)[number];

export type { SubprocessExecutor };

/** Bản nháp: `defKey` rỗng = chưa chọn quy trình con; `inputMap`: đầu vào của quy trình con → nguồn ở quy trình cha. */
export type SubprocessDraft = { defKey: string; inputMap: Record<string, string> };

export const emptySubprocess = (): SubprocessDraft => ({ defKey: "", inputMap: {} });

export const isSubprocessNode = (node: string | undefined): boolean => node === SUBPROCESS_NODE;
export const isSubprocessExecutor = (executor: string): boolean => executor === SUBPROCESS_EXECUTOR;

/**
 * Executor → phần nháp. Rẽ theo kết quả (`branches[].on` = rejected | cancelled ⇒ bước `goto_step`) dùng CHUNG khối `wait.branches` của nháp
 * (cùng dạng `{ on, step }` với `wait_event` của Ký số) ⇒ kéo nối cổng, tính đích bước, đổi số bước đều đi qua đường đã có.
 */
export function subprocessFromDef(ex: SubprocessExecutor): {
  subprocess: SubprocessDraft;
  wait: WaitDraft;
} {
  return {
    subprocess: { defKey: ex.def_key, inputMap: { ...(ex.input_map ?? {}) } },
    wait: {
      ...emptyWait(),
      ...(ex.branches?.length
        ? { branches: ex.branches.map((b) => ({ on: b.on, step: b.goto_step })) }
        : {}),
    },
  };
}

/** Bản nháp → executor; ô ánh xạ trống bị bỏ; nhánh chưa chọn đích hoặc không phải rejected/cancelled bị bỏ. */
export function subprocessToDef(
  d: SubprocessDraft | undefined,
  wait?: Pick<WaitDraft, "branches">,
): SubprocessExecutor {
  const map = Object.fromEntries(
    Object.entries(d?.inputMap ?? {}).filter(([k, v]) => k !== "" && v !== ""),
  );
  const branches: NonNullable<SubprocessExecutor["branches"]> = [];
  for (const b of wait?.branches ?? [])
    if (b.step !== null && (b.on === "rejected" || b.on === "cancelled"))
      branches.push({ on: b.on, goto_step: b.step });
  return {
    kind: SUBPROCESS_KIND,
    def_key: d?.defKey ?? "",
    ...(Object.keys(map).length > 0 ? { input_map: map } : {}),
    ...(branches.length > 0 ? { branches } : {}),
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

/**
 * Một quy trình có thể chọn làm con — hình chung của hai nguồn: danh sách flow của công ty (`company_flows`, gồm flow Thư viện được GÁN) và
 * danh sách `process-defs` (platform sửa Thư viện). `id` = id def (mở bằng `/processes/$id`).
 */
export type ChildSource = {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  published_version?: number | null | undefined;
  stage_count?: number | undefined;
};

/** Dòng danh sách flow công ty → nguồn chọn (bản đã xuất bản = có `rel_version`; đang bật = `enabled`). */
export const childSourceOfFlow = (r: CompanyFlowRow): ChildSource => ({
  id: r.flow_id,
  key: r.flow_key,
  name: r.name,
  enabled: r.enabled,
  published_version: r.rel_version,
});

export type ChildStatus = "published" | "enabled" | "draft";

/** Trạng thái hiện cạnh tên: Đã xuất bản (thư viện) · Đang bật (của công ty) · Nháp (chưa chọn được). */
export function childStatus(d: Pick<ChildSource, "enabled" | "published_version">): ChildStatus {
  if (d.published_version != null) return "published";
  return d.enabled ? "enabled" : "draft";
}

/** Chọn làm quy trình con được khi đã xuất bản hoặc đang bật. */
export const childPickable = (d: Pick<ChildSource, "enabled" | "published_version">) =>
  childStatus(d) !== "draft";

export type ChildOption = {
  key: string;
  id: string;
  name: string;
  status: ChildStatus;
  /** Số bước của quy trình con (vắng ⇒ danh sách flow công ty không kèm số bước). */
  steps: number | undefined;
  disabled: boolean;
};

/**
 * Các quy trình có thể chọn làm con: cùng công ty (danh sách đã theo công ty), không phải chính nó (vòng tự gọi — máy chủ vẫn kiểm `SUBPROCESS_CYCLE`).
 * Nháp vẫn hiện nhưng không chọn được (cho người dùng biết vì sao thiếu).
 */
export function childOptions(
  defs: readonly ChildSource[],
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
 * Quy trình con TRẢ gì: các ô kết quả của form / bước của nó, ghi vào dữ liệu của cha dưới dạng `sub_<ô>` (engine). Trùng khoá chỉ kể một lần.
 */
export function childReturns(def: Pick<ProcessDef, "stages"> | undefined): ChildReturn[] {
  const out = new Map<string, ChildReturn>();
  for (const s of def?.stages ?? []) {
    const ex = s.executor as { kind: string; fields?: readonly { key: string; label?: string }[] };
    for (const f of [...(ex.kind === "form" ? (ex.fields ?? []) : []), ...s.output.fields]) {
      const label = "label" in f && typeof f.label === "string" && f.label !== "" ? f.label : f.key;
      if (!out.has(f.key)) out.set(f.key, { key: `${SUBPROCESS_FIELD_PREFIX}${f.key}`, label });
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
