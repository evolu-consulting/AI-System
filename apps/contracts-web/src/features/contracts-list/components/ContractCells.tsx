// HD-FR-51 · S03 · V2-F (HD-03 · mockup NITI `renderCList`): ô bảng — Hợp đồng (tên + số / phụ lục của), Đối tác, Loại, Giá trị, Hiệu lực,
// Giai đoạn (+ bước hiện tại, đỏ khi quá hạn), Thao tác (Xem; Xoá ẩn tới V2-M). Thẻ điện thoại: một thẻ mỗi HĐ.
import type { ContractListRow, ContractProgress, DealSource, DocType } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Tag } from "~/components/shared/tag";
import { VersionBadge } from "~/features/contract-versions/components/VersionBadge";
import { cn } from "~/lib/utils";
import { deleteAction } from "../lib/delete-action";
import { STATUS_VIEW, shortName, statusLabel } from "../lib/list-model";
import { DEAL_TONE, dealOfRow, partnerOfRow, STAGE_TONE, stageView } from "../lib/row-view";
import { DocTypeTag, EyeIcon, SourceName } from "./ChildRows";

export type RowCtx = {
  /** Tiêu đề HĐ gốc của hàng phụ lục trong trang (`parents` của API). */
  parents: ReadonlyMap<string, string>;
  /** Giai đoạn + bước hiện tại theo id HĐ (`progress` của API, V2-A). */
  progress: ReadonlyMap<string, ContractProgress>;
  /** DOC-ui-list: loại chứng từ theo id hàng (`docs` của API); vắng ⇒ HĐ kinh tế. */
  docs?: ReadonlyMap<string, DocType>;
  /** DOC-ui-gaps: nguồn giao dịch theo id hàng (`docs[].source`). */
  sources?: ReadonlyMap<string, DealSource | null>;
  /** Vai quản lý (`useMe().owner`) ⇒ hiện nút Xoá. */
  owner?: boolean;
  /** Mở hộp xoá của HĐ `id`. */
  onDelete?: (id: string) => void;
};

export const COLUMN_KEYS = ["title", "partner", "type", "value", "dates", "stage"] as const;
/** DOC-ui-gaps: cột "Nguồn" chỉ hiện khi lọc Giao dịch (HĐ không có nguồn); chèn sau "Loại". */
export const COLUMN_KEYS_DEAL = [
  "title",
  "partner",
  "type",
  "source",
  "value",
  "dates",
  "stage",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS_DEAL)[number];
export const columnKeysOf = (docType: string): readonly ColumnKey[] =>
  docType === "deal" ? COLUMN_KEYS_DEAL : COLUMN_KEYS;

const TD = "px-3 py-3";

/** CR-097 K3a: 🔒 trước tên HĐ đã xác nhận (khoá). */
function RowLock() {
  const { t } = useTranslation();
  return (
    <span data-testid="row-lock" role="img" aria-label={t("contracts.lock.badge")}>
      🔒{" "}
    </span>
  );
}

function SubLine({ r, ctx }: { r: ContractListRow; ctx: RowCtx }) {
  const { t } = useTranslation();
  const parent = r.parent_id ? ctx.parents.get(r.parent_id) : undefined;
  const parts = [r.number, parent ? t("contracts.list.appendixOf", { title: parent }) : null];
  return (
    <span className="block truncate text-[12.5px] text-dim">
      {parts.filter(Boolean).join(" · ")}
    </span>
  );
}

export function DealTag({ r, ctx }: { r: ContractListRow; ctx: RowCtx }) {
  const { t } = useTranslation();
  const deal = dealOfRow(r, ctx.progress.get(r.id));
  const doc = ctx.docs?.get(r.id);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <DocTypeTag doc={doc} />
      {deal ? (
        <Tag tone={DEAL_TONE[deal]}>{t(`contracts.cform.dealName.${deal}`)}</Tag>
      ) : doc === "framework" || doc === "deal" ? null : (
        <span className="text-dim">—</span>
      )}
    </span>
  );
}

export function StageCell({ r, ctx }: { r: ContractListRow; ctx: RowCtx }) {
  const { t } = useTranslation();
  const v = stageView(r, ctx.progress.get(r.id));
  if (v.kind === "status") {
    const s = STATUS_VIEW[r.status];
    return (
      <Tag
        tone={
          s.tone === "late"
            ? "late"
            : s.tone === "soon"
              ? "soon"
              : s.tone === "act"
                ? "act"
                : "grey"
        }
      >
        {statusLabel(t, r.status)}
      </Tag>
    );
  }
  return (
    <>
      <Tag tone={v.overdue ? "late" : STAGE_TONE[v.stage]}>
        {v.overdue ? t("contracts.cdetail.stageOver") : t(`contracts.cdetail.stage.${v.stage}`)}
      </Tag>
      {v.step && (
        <span className={cn("mt-0.5 block text-[12.5px]", v.overdue ? "text-late" : "text-dim")}>
          {v.step}
        </span>
      )}
    </>
  );
}

function Dates({ r, ctx }: { r: ContractListRow; ctx: RowCtx }) {
  const { t } = useTranslation();
  const start = ctx.progress.get(r.id)?.start_date ?? null;
  if (!start && !r.end_date) return <span className="text-dim">—</span>;
  return (
    <>
      {start ? viDate(start) : "—"}
      <span className="block text-[12.5px] text-dim">
        {t("contracts.list.until", { date: viDate(r.end_date) })}
      </span>
    </>
  );
}

function PartnerCell({ r, ctx }: { r: ContractListRow; ctx: RowCtx }) {
  const name = partnerOfRow(r, dealOfRow(r, ctx.progress.get(r.id)));
  return (
    <td className={cn("min-w-[130px]", TD)} title={name ?? undefined}>
      <span className="line-clamp-2">{shortName(name)}</span>
    </td>
  );
}

/** Ô theo cột;  `title` mang cả liên kết mở HĐ (S05). */
export function cell(key: ColumnKey, r: ContractListRow, ctx: RowCtx): ReactNode {
  switch (key) {
    case "title":
      return (
        <td className="max-w-[260px] px-3 py-3 pl-5">
          <Link
            to="/contracts/$id"
            params={{ id: r.id }}
            className="block truncate font-semibold"
            title={r.title}
            onClick={(e) => e.stopPropagation()}
          >
            {r.locked && <RowLock />}
            {r.title}
            <VersionBadge no={r.version_no} count={r.versions_count} />
          </Link>
          <SubLine r={r} ctx={ctx} />
        </td>
      );
    case "partner":
      return <PartnerCell r={r} ctx={ctx} />;

    case "type":
      return (
        <td className={cn("whitespace-nowrap", TD)}>
          <DealTag r={r} ctx={ctx} />
        </td>
      );
    case "source": {
      const s = ctx.sources?.get(r.id);
      return (
        <td className={cn("whitespace-nowrap", TD)} data-testid="source-cell">
          {s ? <SourceName source={s} /> : <span className="text-dim">—</span>}
        </td>
      );
    }
    case "value":
      return (
        <td className={cn("text-right font-mono whitespace-nowrap", TD)}>
          {r.value != null ? `${vnd(r.value)} đ` : <span className="text-dim">—</span>}
        </td>
      );
    case "dates":
      return (
        <td className={cn("font-mono whitespace-nowrap", TD)}>
          <Dates r={r} ctx={ctx} />
        </td>
      );
    case "stage":
      return (
        <td className={cn("min-w-[150px]", TD)}>
          <StageCell r={r} ctx={ctx} />
        </td>
      );
  }
}

/** Xem (mắt) + Xoá (thùng rác, chỉ vai quản lý) — nút biểu tượng không viền. Nhiều phiên bản ⇒ Xoá bị khoá kèm lý do. */
function RowActions({ r, ctx }: { r: ContractListRow; ctx: RowCtx }) {
  const { t } = useTranslation();
  const del = deleteAction(r, ctx.owner);
  return (
    <span className="inline-flex items-center gap-1">
      <Link
        to="/contracts/$id"
        params={{ id: r.id }}
        className="btn-icon-ghost"
        aria-label={t("contracts.list.viewContract")}
        title={t("contracts.list.viewContract")}
        data-testid="row-view"
        data-contract={r.title}
        onClick={(e) => e.stopPropagation()}
      >
        <EyeIcon />
      </Link>
      {del !== "hidden" && (
        <button
          type="button"
          className="btn-icon-ghost"
          aria-label={t("contracts.list.deleteContract")}
          title={
            del === "versions" ? t("contracts.del.hasVersions") : t("contracts.list.deleteContract")
          }
          data-testid="row-delete"
          data-contract={r.title}
          disabled={del === "versions"}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onDelete?.(r.id);
          }}
        >
          <TrashIcon />
        </button>
      )}
    </span>
  );
}

/** Cột "Thao tác". */
export function ActionsCell({ r, ctx }: { r: ContractListRow; ctx: RowCtx }) {
  return (
    <td className="px-3 py-3 pr-5 text-right whitespace-nowrap">
      <RowActions r={r} ctx={ctx} />
    </td>
  );
}

const TrashIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
  </svg>
);

/** Thẻ điện thoại: một thẻ mỗi HĐ. */
export function MobileCard({ r, ctx }: { r: ContractListRow; ctx: RowCtx }) {
  const { t } = useTranslation();
  const parent = r.parent_id ? ctx.parents.get(r.parent_id) : undefined;
  const partner = partnerOfRow(r, dealOfRow(r, ctx.progress.get(r.id)));
  return (
    <li className="relative border-b border-rule-soft last:border-0">
      <Link
        to="/contracts/$id"
        params={{ id: r.id }}
        className="flex flex-col gap-1.5 px-4 py-3.5 hover:bg-sunk"
      >
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">
            {r.locked && <RowLock />}
            {r.title}
            <VersionBadge no={r.version_no} count={r.versions_count} />
          </span>
          <DealTag r={r} ctx={ctx} />
        </span>
        {parent && (
          <span className="text-[13px] text-dim">
            {t("contracts.list.appendixOf", { title: parent })}
          </span>
        )}
        <span className="text-[13px] text-dim">
          {[shortName(partner), r.value != null ? `${vnd(r.value)} đ` : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span>
          <StageCell r={r} ctx={ctx} />
        </span>
      </Link>
      <div className="absolute right-2 bottom-2">
        <RowActions r={r} ctx={ctx} />
      </div>
    </li>
  );
}
