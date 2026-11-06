// ADM-FR-65 · CR-056 · P-a F5: dữ liệu + hành động của danh sách quy trình (tab, bộ lọc chip, chép/xoá/chạy/bật).
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { copyDef, deleteDef, useInvalidateDefs, useProcessDefs } from "../api";
import type { CloneSource } from "../components/library/CloneDialog";
import { processErrorSpec } from "../lib/errors";
import { type LibFilter, libFilterSearch } from "../lib/library-filter";
import { type LibraryListItem, useLibraryDefs, useSlots } from "../library-api";
import { useCloneFlow } from "./use-clone-flow";
import { useLibraryRows } from "./use-library-rows";
import { useProcessTenant } from "./use-process-tenant";
import { useToggleEnabled } from "./use-toggle-enabled";

export type Tab = "own" | "templates";
export type StateFilter = "all" | "on" | "off";
type Row = LibraryListItem;

/** Lỗi API → toast. */
function useFail() {
  const { t } = useTranslation();
  return (err: unknown) => {
    const spec = processErrorSpec(err);
    notifyError(t(spec.key, spec.params));
  };
}

/** Xoá có xác nhận gõ tên: giữ dòng đang xoá + hàm xác nhận (ném lại lỗi để hộp thoại ở lại). */
function useDeleteFlow(tenantId: string | undefined) {
  const { t } = useTranslation();
  const fail = useFail();
  const invalidate = useInvalidateDefs();
  const [row, setRow] = useState<Row | null>(null);
  const confirm = async () => {
    if (!row) return;
    try {
      await deleteDef(row.id, row.version, tenantId);
    } catch (err) {
      fail(err);
      throw err;
    }
    notifySuccess(t("process.admin.list.toast.deleted"));
    void invalidate();
  };
  return { row, open: setRow, close: () => setRow(null), confirm };
}

/** Hành động trên dòng; object giữ cố định (cột bảng không dựng lại) và luôn gọi bản mới nhất qua ref. */
function useRowActions(
  tenantId: string | undefined,
  onRun: (r: Row) => void,
  onDelete: (r: Row) => void,
  onCopied: () => void,
  onCloneOpen: (s: CloneSource) => void,
) {
  const { t } = useTranslation();
  const fail = useFail();
  const invalidate = useInvalidateDefs();
  const toggler = useToggleEnabled(tenantId);
  const latest = useRef({
    toggle: toggler.toggle,
    tenantId,
    t,
    invalidate,
    fail,
    onCopied,
    onCloneOpen,
  });
  latest.current = { toggle: toggler.toggle, tenantId, t, invalidate, fail, onCopied, onCloneOpen };
  const actions = useMemo(
    () => ({
      onToggle: (r: Row, v: boolean) => void latest.current.toggle(r, v),
      onRun,
      onDelete,
      onClone: (r: Row) => latest.current.onCloneOpen({ id: r.id, name: r.name }),
      onCopy: (r: Row) => {
        const c = latest.current;
        void copyDef(r.id, c.tenantId).then(() => {
          notifySuccess(c.t("process.admin.list.toast.copied"));
          void c.invalidate();
          // D8a (UAT 2026-10-11) → CR-105: bản chép nằm ở "Mẫu · chạy thử" (xem `goOwn`).
          c.onCopied();
        }, c.fail);
      },
    }),
    [onRun, onDelete],
  );
  return { actions, conflictProps: toggler.conflictProps };
}

export function useProcessesView() {
  const tenant = useProcessTenant();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: Tab } & LibFilter;
  const [filter, setFilter] = useState<StateFilter>("all");
  const [runRow, setRunRow] = useState<Row | null>(null);
  const del = useDeleteFlow(tenant.tenantId);
  // CR-105 · platform_admin: tab chính = thư viện (`kind=library`, không cần chọn tenant); tab Mẫu = `kind=template`.
  // CR-121 c13: /processes chỉ còn là THƯ VIỆN (platform_admin); gán/xem quy trình theo công ty ở Công ty › Quy trình.
  const platformLibrary = tenant.isPlatform;
  const templates = platformLibrary && search.tab === "templates";
  const library = platformLibrary && !templates;
  // Tab "Mẫu · chạy thử" (mọi vai) = `kind=sample`: mẫu + def tenant không khe/không của gói; tab chính của tenant = def của gói.
  const useLib = library || templates;
  const ownQ = useProcessDefs(tenant.tenantId, false, tenant.ready && !useLib);
  const libQ = useLibraryDefs(
    templates ? "sample" : "library",
    tenant.ready && useLib,
    tenant.tenantId,
  );
  const q = useLib ? libQ : ownQ;
  // Sau "Chép mẫu": danh sách MỘT trang tự làm tươi (invalidate) ⇒ chỉ đóng hộp thoại tạo; thư viện platform: sang tab Mẫu như cũ.
  const goOwn = () =>
    void navigate({ to: "/processes", search: { tab: "templates" }, replace: true });
  const goEditor = (id: string) =>
    void navigate({ to: "/processes/$processId", params: { processId: id } });
  const cloneFlow = useCloneFlow(goEditor);
  const slots = useSlots(library);
  const { actions, conflictProps } = useRowActions(
    tenant.tenantId,
    setRunRow,
    del.open,
    goOwn,
    cloneFlow.open,
  );
  // CR-118/120: bộ lọc thư viện (app · việc · trạng thái · tenant) ở URL, lọc phía client trên danh sách đã tải (chỉ tab thư viện).
  const loaded = useMemo(
    () => (q.data ? q.data.pages.flatMap((p) => p.items) : undefined),
    [q.data],
  );
  const { rows, libFilter } = useLibraryRows({
    items: loaded,
    search,
    library,
    templates,
    enabledFilter: filter,
  });
  const app = libFilter.app;
  // "Tạo từ quy trình mặc định": nhân bản def mặc định của khe (từ danh sách đã tải hoặc từ khe).
  const dflt = rows?.find((r) => r.is_default);
  const slot = slots.data?.[0];
  const defaultSrc: CloneSource | null = dflt
    ? { id: dflt.id, name: dflt.name }
    : slot?.default_def_id
      ? { id: slot.default_def_id, name: slot.default_def_name ?? "" }
      : null;
  return {
    tenant,
    app,
    libFilter,
    /** Tất cả dòng thư viện đã tải (chưa lọc) — nguồn tuỳ chọn của popover lọc. */
    allRows: loaded,
    setLibFilter: (f: LibFilter) =>
      void navigate({ to: "/processes", search: libFilterSearch(f), replace: true }),
    clearApp: () => void navigate({ to: "/processes", search: {}, replace: true }),
    tab: (templates ? "templates" : "own") as Tab,
    setTab: (v: Tab) => void navigate({ to: "/processes", search: { tab: v }, replace: true }),
    filter,
    setFilter,
    templates,
    library,
    cloneFlow,
    defaultSrc,
    q,
    rows,
    actions,
    conflictProps,
    runRow,
    closeRun: () => setRunRow(null),
    delRow: del.row,
    closeDelete: del.close,
    confirmDelete: del.confirm,
    canEditTemplates: tenant.isPlatform,
    /** Nút "Tạo quy trình": ở tab Mẫu chỉ platform_admin (tạo mẫu). */
    canWrite: !templates || tenant.isPlatform,
    canRun: !tenant.isPlatform,
  };
}
export type ProcessesView = ReturnType<typeof useProcessesView>;
