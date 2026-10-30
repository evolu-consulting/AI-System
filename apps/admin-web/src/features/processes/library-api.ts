// CR-105 · L3: client Hub của "thư viện quy trình" — MỘT file để chỉnh khi backend (L1/L2a/L2b) lên.
// Hợp đồng: docs/specs/process-library/design.md §4 + quyết định readiness (KHÔNG có tiền tố `/process-library`: mở rộng `/process-defs…`
// + `/process-slots` + `/tenants/:tid/process-slots/:slot`; chỉ platform_admin). Kiểu gõ lỏng — sẽ đổi sang schema `packages/contracts`
// khi L2a đặt response (impact, releases, assignments, process-slots, chi tiết 422) ở đó.
import type {
  ProcessDef,
  ProcessDefInput,
  ProcessDefListItem,
  ProcessDefListResponse,
} from "@ai/contracts/hub-admin";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";
import { LIST_LIMIT, PKEYS } from "./api";

export type LibraryKind = "library" | "template";
export type DealKind = "buy" | "sell" | "referral";

/** Thêm vào `ProcessDefListItem` của `GET /process-defs?kind=…` (design §4: `slot_label`, `tenant_count`, `is_default`; `slot`/`published_version` = khe hở hợp đồng). */
export type LibraryListItem = ProcessDefListItem & {
  slot?: string | null;
  slot_label?: string | null;
  tenant_count?: number;
  is_default?: boolean;
  published_version?: number | null;
};
/** Thêm vào `ProcessDef` (design §1): khe, thân dạng Form theo mã, bản đã xuất bản. */
export type LibraryDef = ProcessDef & {
  slot?: string | null;
  slot_label?: string | null;
  slot_body?: unknown;
  published_version?: number | null;
  is_default?: boolean;
  tenant_count?: number;
};
/** Body ghi nháp: `ProcessDefInput` + `slot` (+ `slot_body` khi lưu từ Form; canvas gửi `stages` ⇒ Hub `fromStages`). */
export type LibraryDefBody = ProcessDefInput & { slot?: string | null; slot_body?: unknown };

export type SlotInfo = {
  slot: string;
  label: string;
  default_def_id: string | null;
  default_def_name?: string | null;
  /** Khe hở: danh mục mã phòng ban gợi ý cho Form (nếu Hub trả). */
  group_keys?: { key: string; label?: string }[];
};
export type ImpactInfo = {
  tenant_count: number;
  active_runs: number;
  /** Khe hở: danh sách tenant đang dùng (nếu Hub trả). */
  tenants?: { id: string; name: string }[];
  /** Có áp cho mọi tenant chưa gán (def đang là mặc định). */
  is_default?: boolean;
};
export type ReleaseItem = {
  rel_version: number;
  published_at: string;
  published_by?: string | null;
  note?: string | null;
  name?: string;
};
export type AssignmentItem = {
  tenant_id: string;
  tenant_name: string;
  tenant_key?: string;
  assigned_at?: string;
};
/** Khe hở: `GET /tenants/:tid/process-slots` (design chỉ có PUT/DELETE). */
export type TenantSlotInfo = {
  slot: string;
  label: string;
  def_id: string | null;
  def_name: string | null;
  rel_version: number | null;
  is_default: boolean;
};
export type PreviewStep = { key: string; name: string; run: boolean };
export type PreviewFacts = { deal: DealKind; total_value: number | null };

const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};
const enc = encodeURIComponent;
const D = (id: string) => `/process-defs/${enc(id)}`;
const T = (tid: string, slot: string) => `/tenants/${enc(tid)}/process-slots/${enc(slot)}`;

/** Hub có thể trả mảng trần hoặc `{items}`. */
export const itemsOf = <T>(r: T[] | { items: T[] } | null | undefined): T[] =>
  Array.isArray(r) ? r : (r?.items ?? []);

export const LKEYS = {
  slots: ["process", "slots"] as const,
  list: (kind: LibraryKind) => ["process", "defs", "library", kind] as const,
  impact: (id: string) => ["process", "defs", "impact", id] as const,
  releases: (id: string) => ["process", "defs", "releases", id] as const,
  assignments: (id: string) => ["process", "defs", "assignments", id] as const,
  tenantSlots: (tid: string) => ["process", "tenant-slots", tid] as const,
};

// ---------- đọc ----------
/** `GET /process-defs?kind=library|template` — danh sách thư viện (chỉ platform_admin) hoặc mẫu chạy thử. */
export function useLibraryDefs(kind: LibraryKind, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: LKEYS.list(kind),
    enabled: enabled && hubConfigured(),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ProcessDefListResponse) => last.next_cursor ?? undefined,
    queryFn: ({ pageParam }) =>
      api<ProcessDefListResponse>(url("/process-defs"), {
        query: {
          kind,
          include_templates: String(kind === "template"),
          limit: LIST_LIMIT,
          cursor: pageParam,
        },
      }),
  });
}

export function useSlots(enabled: boolean) {
  return useQuery({
    queryKey: LKEYS.slots,
    enabled: enabled && hubConfigured(),
    staleTime: 30_000,
    queryFn: async () =>
      itemsOf(await api<SlotInfo[] | { items: SlotInfo[] }>(url("/process-slots"))),
  });
}

export const useImpact = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: LKEYS.impact(id),
    enabled: enabled && hubConfigured(),
    staleTime: 0,
    queryFn: () => api<ImpactInfo>(url(`${D(id)}/impact`)),
  });

export const useReleases = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: LKEYS.releases(id),
    enabled: enabled && hubConfigured(),
    staleTime: 0,
    queryFn: async () =>
      itemsOf(await api<ReleaseItem[] | { items: ReleaseItem[] }>(url(`${D(id)}/releases`))),
  });

export const useAssignments = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: LKEYS.assignments(id),
    enabled: enabled && hubConfigured(),
    staleTime: 0,
    queryFn: async () =>
      itemsOf(
        await api<AssignmentItem[] | { items: AssignmentItem[] }>(url(`${D(id)}/assignments`)),
      ),
  });

export const useTenantSlots = (tenantId: string, enabled: boolean) =>
  useQuery({
    queryKey: LKEYS.tenantSlots(tenantId),
    enabled: enabled && hubConfigured(),
    retry: false,
    queryFn: async () =>
      itemsOf(
        await api<TenantSlotInfo[] | { items: TenantSlotInfo[] }>(
          url(`/tenants/${enc(tenantId)}/process-slots`),
        ),
      ),
  });

// ---------- ghi (hàm thuần gọi Hub; cache làm tươi ở `useLibraryRefresh`) ----------
export const saveLibraryDef = (
  id: string,
  body: LibraryDefBody & { version: number },
): Promise<LibraryDef> => api<LibraryDef>(url(D(id)), { method: "PUT", body });

export const publishDef = (id: string, version: number, note: string) =>
  api<{ rel_version: number }>(url(`${D(id)}/publish`), {
    method: "POST",
    body: note.trim() === "" ? { version } : { version, note: note.trim() },
  });

export const rollbackDef = (id: string, relVersion: number) =>
  api<{ rel_version: number }>(url(`${D(id)}/rollback`), {
    method: "POST",
    body: { rel_version: relVersion },
  });

export const cloneDef = (id: string): Promise<LibraryDef> =>
  api<LibraryDef>(url(`${D(id)}/clone`), { method: "POST", body: {} });

export const setSlotDefault = (slot: string, defId: string) =>
  api<unknown>(url(`/process-slots/${enc(slot)}/default`), {
    method: "PUT",
    body: { def_id: defId },
  });

export const assignTenant = (tenantId: string, slot: string, defId: string) =>
  api<unknown>(url(T(tenantId, slot)), { method: "PUT", body: { def_id: defId } });

export const unassignTenant = (tenantId: string, slot: string) =>
  api<undefined>(url(T(tenantId, slot)), { method: "DELETE" });

export const previewDef = (id: string, facts: PreviewFacts) =>
  api<unknown>(url(`${D(id)}/preview`), { method: "POST", body: facts });

/** Làm tươi mọi thứ của thư viện sau khi xuất bản / quay lại / gán / đổi mặc định / nhân bản. */
export function useLibraryRefresh() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: PKEYS.defs }),
      qc.invalidateQueries({ queryKey: LKEYS.slots }),
      qc.invalidateQueries({ queryKey: ["process", "tenant-slots"] }),
    ]);
}

export function usePreview(id: string) {
  return useMutation({ mutationFn: (facts: PreviewFacts) => previewDef(id, facts) });
}
