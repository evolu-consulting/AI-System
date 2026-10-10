// ADM-FR-65 · CR-056 · P-a F5: dữ liệu + hành động của danh sách quy trình (tab, bộ lọc chip, chép/xoá/chạy/bật).
import type { ProcessDefListItem } from "@ai/contracts/hub-admin";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { copyDef, deleteDef, useInvalidateDefs, useProcessDefs } from "../api";
import { processErrorSpec } from "../lib/errors";
import { useProcessTenant } from "./use-process-tenant";
import { useToggleEnabled } from "./use-toggle-enabled";

export type Tab = "own" | "templates";
export type StateFilter = "all" | "on" | "off";
type Row = ProcessDefListItem;

export function filterRows(rows: Row[], f: StateFilter): Row[] {
  return f === "all" ? rows : rows.filter((r) => r.enabled === (f === "on"));
}

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
) {
  const { t } = useTranslation();
  const fail = useFail();
  const invalidate = useInvalidateDefs();
  const toggler = useToggleEnabled(tenantId);
  const latest = useRef({ toggle: toggler.toggle, tenantId, t, invalidate, fail, onCopied });
  latest.current = { toggle: toggler.toggle, tenantId, t, invalidate, fail, onCopied };
  const actions = useMemo(
    () => ({
      onToggle: (r: Row, v: boolean) => void latest.current.toggle(r, v),
      onRun,
      onDelete,
      onCopy: (r: Row) => {
        const c = latest.current;
        void copyDef(r.id, c.tenantId).then(() => {
          notifySuccess(c.t("process.admin.list.toast.copied"));
          void c.invalidate();
          // D8a (UAT 2026-10-11): sang tab "Của công ty" để thấy bản vừa chép (không kẹt ở tab Mẫu).
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
  const needsTenant = tenant.isPlatform && !tenant.tenantId && !templates;
  const q = useProcessDefs(tenant.tenantId, templates, tenant.ready && !needsTenant);
  const goOwn = () => void navigate({ to: "/processes", search: { tab: "own" }, replace: true });
  const { actions, conflictProps } = useRowActions(tenant.tenantId, setRunRow, del.open, goOwn);
  const rows = useMemo(() => {
    if (!q.data) return undefined;
    const all = q.data.pages.flatMap((p) => p.items).filter((r) => r.is_template === templates);
    return templates ? all : filterRows(all, filter);
  }, [q.data, templates, filter]);
  return {
    tenant,
    tab: (templates ? "templates" : "own") as Tab,
    setTab: (v: Tab) => void navigate({ to: "/processes", search: { tab: v }, replace: true }),
    filter,
    setFilter,
    templates,
    needsTenant,
    q,
    rows,
    actions,
    conflictProps,
    runRow,
    closeRun: () => setRunRow(null),
    delRow: del.row,
    closeDelete: del.close,
    confirmDelete: del.confirm,
    canWrite: templates ? tenant.isPlatform : true,
    canRun: !tenant.isPlatform,
  };
}
export type ProcessesView = ReturnType<typeof useProcessesView>;
