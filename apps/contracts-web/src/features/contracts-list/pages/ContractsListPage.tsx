// HD-FR-51 · S03 · V2-F (HD-03 · mockup NITI "Hợp đồng"): thanh tìm + lọc + chọn cột, bảng (desktop) / thẻ (điện thoại) với cột Hợp đồng,
// Đối tác, Loại, Giá trị, Hiệu lực, Giai đoạn (+ bước hiện tại, đỏ khi quá hạn), Thao tác (Xem); bấm hàng mở HĐ. Nút "Thêm thủ công" +
// "Upload hợp đồng" (cần quyền ghi). Dữ liệu phía server (HD1 list + `progress` V2-A). Nút Xoá ẩn tới V2-M (đảo sổ kho khi xoá).
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { promptDialog } from "~/components/shared/dialog-bus";
import { PageHead, Panel } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { toast } from "~/components/shared/toast";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { ColumnFilters, ColumnPicker, Pager, TableTools, useColumns } from "~/features/table";
import { CATEGORIES_KEY, createCategory, uploadContract } from "../api";
import {
  ActionsCell,
  COLUMN_KEYS,
  type ColumnKey,
  cell,
  MobileCard,
  type RowCtx,
} from "../components/ContractCells";
import { useContractsList } from "../hooks/use-contracts-list";
import { uploadErrorText } from "../list-upload-error";

const errText = (e: unknown, t: (k: string) => string): string =>
  (e as { status?: number } | null)?.status === 409
    ? t("contracts.list.categoryExists")
    : t("contracts.errors.unknown");

export function ContractsListPage() {
  const { t } = useTranslation();
  const { write } = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const { t: table, list } = useContractsList(
    write ? addCategoryButton(t, () => void addCategory()) : undefined,
  );
  const cols = useColumns(
    "contracts-v2",
    COLUMN_KEYS.map((key) => ({
      key,
      label: t(`contracts.list.col.${key}`),
      locked: key === "title" || key === "stage",
    })),
  );
  const ctx: RowCtx = useMemo(
    () => ({
      parents: new Map((list.data?.parents ?? []).map((p) => [p.id, p.title])),
      progress: new Map((list.data?.progress ?? []).map((p) => [p.id, p])),
    }),
    [list.data],
  );

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

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr(null);
    try {
      const r = await uploadContract(f);
      await nav({ to: "/contracts/$id", params: { id: r.id } });
    } catch (e) {
      setErr(uploadErrorText(e, t));
    }
  }

  const items = list.data?.items ?? [];
  const shown = COLUMN_KEYS.filter((k) => cols.shows(k));
  const row = (k: ColumnKey, r: (typeof items)[number]) => cell(k, r, ctx);
  return (
    // Thân trang như mgmt-app (`index.css:78-82`: 16 px, line-height 1.55); khung list tự giữ cuộn (Shell `layoutOf` = board).
    <div className="text-base leading-[1.55] md:flex md:min-h-0 md:flex-1 md:flex-col">
      <PageHead
        title={t("contracts.contractsPage.title")}
        actions={
          write && (
            <>
              <input
                ref={file}
                type="file"
                hidden
                accept=".pdf,.docx,.png,.jpg,.jpeg"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  e.target.value = "";
                  void onFile(picked);
                }}
              />
              <Link to="/contracts/new" className="btn btn-outline btn-sm">
                <PlusIcon />
                {t("contracts.list.manual")}
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
          )
        }
      />
      {err && (
        <p role="alert" className="mb-3 text-sm text-late">
          {err}
        </p>
      )}
      <TableTools
        q={table.q}
        setQ={table.setQ}
        total={table.total}
        placeholder={t("contracts.list.search")}
      >
        <ColumnFilters filter={table.filter} />
        <span className="max-sm:hidden">
          <ColumnPicker cols={cols} />
        </span>
      </TableTools>
      <Panel className="md:flex md:min-h-0 md:flex-1 md:flex-col">
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <ErrorLine error={list.error} />
        ) : !table.total && !hasFilters(table) ? (
          <Empty title={t("contracts.list.emptyTitle")}>{t("contracts.list.emptyBody")}</Empty>
        ) : !items.length ? (
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
                  {items.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => void nav({ to: "/contracts/$id", params: { id: r.id } })}
                      className="cursor-pointer border-b border-rule-soft align-top last:border-0 hover:bg-sunk"
                    >
                      {shown.map((k) => (
                        <Fragment key={k}>{row(k, r)}</Fragment>
                      ))}
                      <ActionsCell r={r} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="sm:hidden">
              {items.map((r) => (
                <MobileCard key={r.id} r={r} ctx={ctx} />
              ))}
            </ul>
          </>
        )}
        <Pager t={table} />
      </Panel>
    </div>
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

const PlusIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);
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
