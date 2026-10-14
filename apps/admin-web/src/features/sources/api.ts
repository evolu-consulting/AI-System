// ADM-FR-68 · HUB-FR-120 · gọi Hub `/admin/sources*` (NƠI DUY NHẤT; editor quy trình dùng `useSourceOptions`, FS3).
// platform_admin luôn kèm `tenant_id` (server: vắng ⇒ 404/422); tenant_admin không truyền. Không log/URL nào chứa `config.path`.
import type {
  HubSecret,
  HubSecretListResponse,
  HubSecretRotateRequest,
  LibraryDocListResponse,
  SourceCheckResult,
  SourceCreateRequest,
  SourceCredentialCreateRequest,
  SourceKind,
  SourceListResponse,
  SourceUpdateRequest,
  SourceView,
} from "@ai/contracts/hub-admin";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

export const SOURCES_PAGE_SIZE = 100;
export const LIBRARY_DOCS_PAGE_SIZE = 20;
const OPTIONS_MAX_PAGES = 5;
const STALE_MS = 30_000;

export const SKEYS = {
  all: ["sources"] as const,
  list: (tenantId: string | undefined, kind: SourceKind | undefined) =>
    ["sources", "list", tenantId ?? "", kind ?? ""] as const,
  one: (key: string, tenantId: string | undefined) =>
    ["sources", "one", key, tenantId ?? ""] as const,
  options: (tenantId: string | undefined) => ["sources", "options", tenantId ?? ""] as const,
  docs: (tenantId: string | undefined, q: string) =>
    ["sources", "library-docs", tenantId ?? "", q] as const,
};

const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};
const item = (key: string, suffix = ""): string =>
  url(`/admin/sources/${encodeURIComponent(key)}${suffix}`);

// ---------- danh sách (cursor) ----------
export function useSourceList(
  p: { tenantId: string | undefined; kind: SourceKind | undefined },
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: SKEYS.list(p.tenantId, p.kind),
    enabled: enabled && hubConfigured(),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: SourceListResponse) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      api<SourceListResponse>(url("/admin/sources"), {
        query: {
          tenant_id: p.tenantId,
          kind: p.kind,
          limit: SOURCES_PAGE_SIZE,
          cursor: pageParam,
        },
      }),
  });
}

// ---------- một nguồn ----------
export const fetchSource = (key: string, tenantId?: string): Promise<SourceView> =>
  api<SourceView>(item(key), { query: { tenant_id: tenantId } });

export function useSource(key: string | undefined, tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: SKEYS.one(key ?? "", tenantId),
    enabled: enabled && hubConfigured() && !!key,
    staleTime: 0,
    queryFn: () => fetchSource(key as string, tenantId),
  });
}

// ---------- ghi ----------
export const createSource = (body: SourceCreateRequest): Promise<SourceView> =>
  api<SourceView>(url("/admin/sources"), { method: "POST", body });

export const updateSource = (
  key: string,
  body: SourceUpdateRequest,
  tenantId?: string,
): Promise<SourceView> =>
  api<SourceView>(item(key), { method: "PUT", query: { tenant_id: tenantId }, body });

export const deleteSource = (key: string, version: number, tenantId?: string): Promise<undefined> =>
  api<undefined>(item(key), { method: "DELETE", query: { tenant_id: tenantId, version } });

/** Đồng bộ tới `timeout_s` của Hub (mặc định 60 s) ⇒ truyền `signal` để bỏ khi đóng drawer / quá 130 s (FS6). */
export const checkSource = (
  key: string,
  tenantId: string | undefined,
  signal: AbortSignal,
): Promise<SourceCheckResult> =>
  api<SourceCheckResult>(item(key, "/check"), {
    method: "POST",
    query: { tenant_id: tenantId },
    body: {},
    signal,
  });

/** Làm tươi danh sách + bản đang mở + gợi ý của editor sau mọi thay đổi. */
export function useInvalidateSources() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: SKEYS.all });
}

// ---------- gợi ý cho editor quy trình (FS3) ----------
export type SourceOption = { key: string; kind: SourceKind; description: string };

/** Mọi nguồn của tenant dạng gọn (KHÔNG mang `config`/`last_pin` ⇒ không rò path sang editor). Tối đa 5 trang × 100. */
export function useSourceOptions(tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: SKEYS.options(tenantId),
    enabled: enabled && hubConfigured(),
    staleTime: STALE_MS,
    queryFn: async (): Promise<SourceOption[]> => {
      const out: SourceOption[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < OPTIONS_MAX_PAGES; i++) {
        const res = await api<SourceListResponse>(url("/admin/sources"), {
          query: { tenant_id: tenantId, limit: SOURCES_PAGE_SIZE, cursor },
        });
        for (const s of res.items)
          out.push({ key: s.key, kind: s.kind, description: s.description });
        if (!res.next_cursor) break;
        cursor = res.next_cursor;
      }
      return out;
    },
  });
}

// ---------- khoá nguồn (source_credential · route H4b-1 `/admin/source-credentials*`) ----------
// FC3: token chỉ ở body; mutation `gcTime: 0` để không giữ giá trị trong cache. platform_admin kèm `tenant_id`; tenant_admin không.
export const CREDENTIALS_PAGE_SIZE = 100;
const CRED_BASE = "/admin/source-credentials";

export const CKEYS = {
  all: ["source-credentials"] as const,
  list: (tenantId: string | undefined) => ["source-credentials", "list", tenantId ?? ""] as const,
};

/** Mọi khoá nguồn của tenant (≤ 100, không phân trang trong UI). */
export function useCredentials(tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: CKEYS.list(tenantId),
    enabled: enabled && hubConfigured(),
    staleTime: STALE_MS,
    queryFn: (): Promise<HubSecretListResponse> =>
      api<HubSecretListResponse>(url(CRED_BASE), {
        query: { tenant_id: tenantId, limit: CREDENTIALS_PAGE_SIZE },
      }),
  });
}

export function useInvalidateCredentials() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: CKEYS.all });
}

export function useCreateCredential(tenantId: string | undefined) {
  const invalidate = useInvalidateCredentials();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: SourceCredentialCreateRequest): Promise<HubSecret> =>
      api<HubSecret>(url(CRED_BASE), {
        method: "POST",
        body: { ...body, ...(tenantId ? { tenant_id: tenantId } : {}) },
      }),
    onSuccess: () => invalidate(),
  });
}

export function useRotateCredential(id: string, tenantId: string | undefined) {
  const invalidate = useInvalidateCredentials();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: HubSecretRotateRequest): Promise<HubSecret> =>
      api<HubSecret>(url(`${CRED_BASE}/${encodeURIComponent(id)}`), {
        method: "PUT",
        query: { tenant_id: tenantId },
        body,
      }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteCredential(tenantId: string | undefined) {
  const invalidate = useInvalidateCredentials();
  return useMutation({
    mutationFn: (p: { id: string; version: number }): Promise<undefined> =>
      api<undefined>(url(`${CRED_BASE}/${encodeURIComponent(p.id)}`), {
        method: "DELETE",
        query: { tenant_id: tenantId, version: p.version },
      }),
    onSuccess: () => invalidate(),
  });
}

// ---------- picker tài liệu library (C3) ----------
// TODO FS-4: route `GET /admin/sources/library-documents` do backend S3 làm (hoãn khỏi S1) ⇒ int/e2e thật 404 tới lúc đó.
export function useLibraryDocs(tenantId: string | undefined, q: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: SKEYS.docs(tenantId, q),
    enabled: enabled && hubConfigured(),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: LibraryDocListResponse) => last.next_cursor ?? undefined,
    staleTime: STALE_MS,
    retry: false,
    queryFn: ({ pageParam }) =>
      api<LibraryDocListResponse>(url("/admin/sources/library-documents"), {
        query: {
          tenant_id: tenantId,
          q: q || undefined,
          limit: LIBRARY_DOCS_PAGE_SIZE,
          cursor: pageParam,
        },
      }),
  });
}
