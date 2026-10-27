// HD-FR-51 · S03 · V2-F (HD-03 · mockup NITI "Hợp đồng"): thanh tìm + lọc + chọn cột, bảng (desktop) / thẻ (điện thoại) với cột Hợp đồng,
// Đối tác, Loại, Giá trị, Hiệu lực, Giai đoạn (+ bước hiện tại, đỏ khi quá hạn), Thao tác (Xem); bấm hàng mở HĐ. Nút "Upload hợp đồng"
// (cần quyền ghi; CR-097: bỏ "Thêm thủ công" — HĐ phải có văn bản đã ký). Dữ liệu phía server (HD1 list + `progress` V2-A). Nút Xoá ẩn tới V2-M (đảo sổ kho khi xoá).
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Fragment, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { promptDialog } from "~/components/shared/dialog-bus";
import { PageHead, Panel } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { toast } from "~/components/shared/toast";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { ColumnFilters, ColumnPicker, Pager, TableTools, useColumns } from "~/features/table";
import { CATEGORIES_KEY, createCategory, exportContracts } from "../api";
import { ChildCard, ChildRowCells } from "../components/ChildRows";
import {
  ActionsCell,
  COLUMN_KEYS,
  type ColumnKey,
  cell,
  MobileCard,
  type RowCtx,
} from "../components/ContractCells";
import { DateFilterControl } from "../components/DateFilterControl";
import { DocTypeFilter } from "../components/DocTypeFilter";
import { ExportButtons } from "../components/ExportButtons";
import { QueueExtractDialog } from "../components/ExtractDialog";
import { QuotaDialog } from "../components/QuotaDialog";
import { DropOverlay, UploadPanel } from "../components/UploadPanel";
import { useContractsList } from "../hooks/use-contracts-list";
import { useDeleteDialog } from "../hooks/use-delete-dialog";
import { useUploadQueue } from "../hooks/use-upload-queue";
import {
  type DateFilter,
  dateFilterOf,
  isDateActive,
  parseDateSearch,
  toDateSearch,
} from "../lib/date-filter";
import { buildRows, type DocFilter, parseDocFilter } from "../lib/doc-list";
import { UPLOAD_ACCEPT } from "../lib/upload-queue";

const errText = (e: unknown, t: (k: string) => string): string =>
  (e as { status?: number } | null)?.status === 409
    ? t("contracts.list.categoryExists")
    : t("contracts.errors.unknown");

export function ContractsListPage() {
  const { t } = useTranslation();
  const { write, owner } = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  // Gap #10: lọc ngày nằm trên URL (`?due=` `?dfield=` `?df=` `?dt=`).
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const date = dateFilterOf(parseDateSearch(search));
  const docType = parseDocFilter(search.type);
  const {
    t: table,
    list,
    exportQs,
    counts,
  } = useContractsList(
    write ? addCategoryButton(t, () => void addCategory()) : undefined,
    date,
    docType,
  );
  const setDocType = (f: DocFilter) => {
    table.setPage(1);
    void nav({
      to: ".",
      search: ((prev: object) => ({ ...prev, type: f === "all" ? undefined : f })) as never,
      replace: true,
    });
  };
  const setDate = (f: DateFilter) => {
    table.setPage(1);
    void nav({
      to: ".",
      search: ((prev: object) => ({ ...prev, ...toDateSearch(f) })) as never,
      replace: true,
    });
  };
  const queue = useUploadQueue((id) => void nav({ to: "/contracts/$id", params: { id } }));
  const cols = useColumns(
    "contracts-v2",
    COLUMN_KEYS.map((key) => ({
      key,
      label: t(`contracts.list.col.${key}`),
      locked: key === "title" || key === "stage",
    })),
  );
  const delDialog = useDeleteDialog();
  const ctx: RowCtx = useMemo(
    () => ({
      parents: new Map((list.data?.parents ?? []).map((p) => [p.id, p.title])),
      progress: new Map((list.data?.progress ?? []).map((p) => [p.id, p])),
      docs: new Map((list.data?.docs ?? []).map((d) => [d.id, d.doc_type])),
      owner,
      onDelete: delDialog.open,
    }),
    [list.data, owner, delDialog.open],
  );
  const rows = useMemo(() => buildRows(list.data), [list.data]);

  async function addCategory() {
    const name = await promptDialog({
      title: t("contracts.list.newCategoryTitle"),
      label: t("contracts.list.newCategoryLabel"),
      placeholder: t("contracts.list.newCategoryHint"),
      required: true,
      maxLength: 40,
      confirmLabel: t("contracts.list.newCategoryOk"),
    });
    if (!name) return;
    try {
      await createCategory(name);
      await qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
      await qc.invalidateQueries({ queryKey: ["contracts", "facets"] });
      toast(t("contracts.list.categoryAdded"));
    } catch (e) {
      setErr(errText(e, t));
    }
  }

  const items = list.data?.items ?? [];
  const hasRows = rows.length > 0;
  const shown = COLUMN_KEYS.filter((k) => cols.shows(k));
  const row = (k: ColumnKey, r: (typeof items)[number]) => cell(k, r, ctx);
  return (
    // Thân trang như mgmt-app (`index.css:78-82`: 16 px, line-height 1.55); khung list tự giữ cuộn (Shell `layoutOf` = board).
    <DropOverlay
      enabled={!!write}
      onFiles={queue.enqueue}
      className="text-base leading-[1.55] md:flex md:min-h-0 md:flex-1 md:flex-col"
    >
      <PageHead
        title={t("contracts.contractsPage.title")}
        actions={
          <>
            <ExportButtons run={(f) => exportContracts(exportQs(f))} />
            {write && (
              <>
                <input
                  ref={file}
                  type="file"
                  hidden
                  multiple
                  accept={UPLOAD_ACCEPT}
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    queue.enqueue(picked);
                  }}
                />
                <Link
                  to="/contracts/new"
                  search={{ type: "deal" }}
                  className="btn btn-quiet btn-sm"
                  data-testid="add-deal"
                >
                  {t("contracts.doclist.addDeal")}
                </Link>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => file.current?.click()}
                >
                  <UploadIcon />
                  {t("contracts.list.add")}
                </button>
              </>
            )}
          </>
        }
      />
      {delDialog.node}
      <QuotaDialog notice={queue.quota} onClose={queue.dismissQuota} />
      <QueueExtractDialog items={queue.items} />
      <UploadPanel items={queue.items} onRetry={queue.retry} onClose={queue.clear} />
      {err && (
        <p role="alert" className="mb-3 text-sm text-late">
          {err}
        </p>
      )}
      <DocTypeFilter value={docType} counts={counts} onChange={setDocType} />
      <TableTools
        q={table.q}
        setQ={table.setQ}
        total={table.total}
        placeholder={t("contracts.list.search")}
      >
        <ColumnFilters filter={table.filter} />
        <DateFilterControl value={date} onChange={setDate} />
        <span className="max-sm:hidden">
          <ColumnPicker cols={cols} />
        </span>
      </TableTools>
      <Panel className="md:flex md:min-h-0 md:flex-1 md:flex-col">
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <ErrorLine error={list.error} />
        ) : !table.total && !hasFilters(table) && !isDateActive(date) && docType === "all" ? (
          <Empty title={t("contracts.list.emptyTitle")}>{t("contracts.list.emptyBody")}</Empty>
        ) : !hasRows ? (
          <Empty title={t("contracts.list.noMatchTitle")}>{t("contracts.list.noMatchBody")}</Empty>
        ) : (
          <>
            <div className="overflow-auto max-sm:hidden md:min-h-0 md:flex-1">
              <table
                className="w-full text-[13.5px]"
                style={{ minWidth: Math.max(560, (shown.length + 1) * 135) }}
              >
                <thead className="text-left text-[12px] text-dim">
                  <tr>
                    {shown.map((k) => (
                      <th
                        key={k}
                        className={`sticky top-0 z-10 bg-sunk px-3 py-2.5 font-semibold first:pl-5 ${k === "value" ? "text-right" : ""}`}
                      >
                        {t(`contracts.list.col.${k}`)}
                      </th>
                    ))}
                    <th className="sticky top-0 z-10 bg-sunk px-3 py-2.5 pr-5 text-right font-semibold">
                      {t("contracts.list.col.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) =>
                    x.kind === "item" ? (
                      <tr
                        key={x.item.id}
                        onClick={() =>
                          void nav({ to: "/contracts/$id", params: { id: x.item.id } })
                        }
                        className="cursor-pointer border-b border-rule-soft align-top last:border-0 hover:bg-sunk"
                      >
                        {shown.map((k) => (
                          <Fragment key={k}>{row(k, x.item)}</Fragment>
                        ))}
                        <ActionsCell r={x.item} ctx={ctx} />
                      </tr>
                    ) : (
                      <tr
                        key={`c-${x.child.id}`}
                        data-testid="child-row"
                        onClick={() =>
                          void nav({ to: "/contracts/$id", params: { id: x.child.id } })
                        }
                        className="cursor-pointer border-b border-rule-soft bg-sunk/40 align-top last:border-0 hover:bg-sunk"
                      >
                        <ChildRowCells child={x.child} orphan={x.orphan} shown={shown} />
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <ul className="sm:hidden">
              {rows.map((x) =>
                x.kind === "item" ? (
                  <MobileCard key={x.item.id} r={x.item} ctx={ctx} />
                ) : (
                  <ChildCard key={`c-${x.child.id}`} child={x.child} orphan={x.orphan} />
                ),
              )}
            </ul>
          </>
        )}
        <Pager t={table} />
      </Panel>
    </DropOverlay>
  );
}

const hasFilters = (t: ReturnType<typeof useContractsList>["t"]) =>
  t.q.trim().length > 0 || t.filter.active.length > 0;

function addCategoryButton(t: (k: string) => string, onClick: () => void) {
  return (
    <button
      type="button"
      className="text-[12.5px] font-medium text-act hover:underline"
      onClick={onClick}
    >
      {t("contracts.list.newCategory")}
    </button>
  );
}

const UploadIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
  </svg>
);
