// CR-105 · L3: client Hub của "thư viện quy trình" — MỘT file. Kiểu lấy từ `packages/contracts/src/hub-admin/process-library.ts`.
// Hợp đồng (readiness + L2a): KHÔNG tiền tố `/process-library` — mở rộng `/process-defs…` + `/process-slots` +
// `/tenants/:tid/process-slots/:slot`; chỉ platform_admin; mọi danh sách là `{items:[…]}`.
import type {
  ProcessAssignment,
  ProcessDef,
  ProcessDefInput,
  ProcessDefListItem,
  ProcessDefListResponse,
  ProcessImpact,
  ProcessRelease,
  ProcessSlot,
  ReleaseRef,
  TenantProcessSlot,
} from "@ai/contracts/hub-admin";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";
import { LIST_LIMIT, PKEYS } from "./api";

export type LibraryKind = "library" | "template";
export type DealKind = "buy" | "sell" | "referral";

/** Mục danh sách / def đã có `slot`, `slot_label`, `published_version`, `is_default`, `tenant_count` (= số tenant đang GÁN) từ contracts. */
export type LibraryListItem = ProcessDefListItem;
export type LibraryDef = ProcessDef;
/** Body ghi nháp: Form gửi `slot_body` (thắng `stages`); Canvas gửi `stages` + `slot`. */
export type LibraryDefBody = ProcessDefInput;
export type SlotInfo = ProcessSlot;
/** `tenant_count` của impact gồm cả tenant đang chạy mặc định (khác `tenant_count` của danh sách). */
export type ImpactInfo = ProcessImpact;
export type ReleaseItem = ProcessRelease;
export type AssignmentItem = ProcessAssignment;
export type TenantSlotInfo = TenantProcessSlot;
export type PreviewStep = { key: string; name: string; run: boolean };
/** `POST …/preview`: `value` bắt buộc (số ≥ 0). */
export type PreviewFacts = { contract_type: DealKind; value: number };
const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};
const enc = encodeURIComponent;
const D = (id: string) => `/process-defs/${enc(id)}`;
const T = (tid: string, slot: string) => `/tenants/${enc(tid)}/process-slots/${enc(slot)}`;

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
    queryFn: async () => (await api<{ items: SlotInfo[] }>(url("/process-slots"))).items,
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
    queryFn: async () => (await api<{ items: ReleaseItem[] }>(url(`${D(id)}/releases`))).items,
  });

export const useAssignments = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: LKEYS.assignments(id),
    enabled: enabled && hubConfigured(),
    staleTime: 0,
    queryFn: async () =>
      (await api<{ items: AssignmentItem[] }>(url(`${D(id)}/assignments`))).items,
  });

export const useTenantSlots = (tenantId: string, enabled: boolean) =>
  useQuery({
    queryKey: LKEYS.tenantSlots(tenantId),
    enabled: enabled && hubConfigured(),
    retry: false,
    queryFn: async () =>
      (await api<{ items: TenantSlotInfo[] }>(url(`/tenants/${enc(tenantId)}/process-slots`)))
        .items,
  });

// ---------- ghi (hàm thuần gọi Hub; cache làm tươi ở `useLibraryRefresh`) ----------
export const saveLibraryDef = (
  id: string,
  body: LibraryDefBody & { version: number },
): Promise<LibraryDef> => api<LibraryDef>(url(D(id)), { method: "PUT", body });

export const publishDef = (id: string, version: number, note: string) =>
  api<ReleaseRef>(url(`${D(id)}/publish`), {
    method: "POST",
    body: note.trim() === "" ? { version } : { version, note: note.trim() },
  });

/** Quay lại = bản MỚI bằng nội dung bản cũ; `version` = nháp đang thấy (khoá lạc quan, như publish). */
export const rollbackDef = (id: string, relVersion: number, version: number) =>
  api<ReleaseRef>(url(`${D(id)}/rollback`), {
    method: "POST",
    body: { rel_version: relVersion, version },
  });

/** Body `{key?, name?}` (bỏ trống ⇒ Hub tự đặt). */
export const cloneDef = (
  id: string,
  body: { key?: string; name?: string } = {},
): Promise<LibraryDef> => api<LibraryDef>(url(`${D(id)}/clone`), { method: "POST", body });

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
