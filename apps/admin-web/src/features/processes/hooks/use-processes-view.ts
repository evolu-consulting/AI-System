// ADM-FR-65 · CR-056 · P-a F5: dữ liệu + hành động của danh sách quy trình (tab, bộ lọc chip, chép/xoá/chạy/bật).
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { copyDef, deleteDef, useInvalidateDefs, useProcessDefs } from "../api";
import type { CloneSource } from "../components/library/CloneDialog";
import { processErrorSpec } from "../lib/errors";
import { sortLibraryRows } from "../lib/library-list";
import { rowsForTab } from "../lib/library-view";
import { type LibraryListItem, useLibraryDefs, useSlots } from "../library-api";
import { useCloneFlow } from "./use-clone-flow";
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
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const templates = search.tab === "templates";
  const [filter, setFilter] = useState<StateFilter>("all");
  const [runRow, setRunRow] = useState<Row | null>(null);
  const del = useDeleteFlow(tenant.tenantId);
  // CR-105 · platform_admin: tab chính = thư viện (`kind=library`, không cần chọn tenant); tab Mẫu = `kind=template`.
  // Chọn một tenant ⇒ xem quy trình của tenant đó như trước.
  const library = tenant.isPlatform && !tenant.tenantId && !templates;
  // Tab "Mẫu · chạy thử" (mọi vai) = `kind=sample`: mẫu + def tenant không khe/không của gói; tab chính của tenant = def của gói.
  const useLib = library || templates;
  const ownQ = useProcessDefs(tenant.tenantId, false, tenant.ready && !useLib);
  const libQ = useLibraryDefs(
    templates ? "sample" : "library",
    tenant.ready && useLib,
    tenant.tenantId,
  );
  const q = useLib ? libQ : ownQ;
  // CR-105: bản "Chép mẫu" thuộc "Mẫu · chạy thử" (def tenant không khe/không của gói) ⇒ ở lại tab này để thấy bản vừa chép.
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
  const rows = useMemo(() => {
    if (!q.data) return undefined;
    const list = rowsForTab(
      q.data.pages.flatMap((p) => p.items),
      templates,
      filter,
    );
    return library ? sortLibraryRows(list) : list; // thư viện: mặc định ghim đầu, còn lại mới cập nhật trước
  }, [q.data, templates, filter, library]);
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
