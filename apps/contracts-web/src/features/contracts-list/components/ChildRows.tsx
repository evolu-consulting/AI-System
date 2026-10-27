// DOC-ui-list: nhãn loại chứng từ + hàng con thụt dưới HĐ nguyên tắc (bảng + thẻ điện thoại) của danh sách "Hợp đồng & giao dịch".
import type { DocType } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { Tag } from "~/components/shared/tag";
import { cn } from "~/lib/utils";
import type { ListFrameChild } from "../lib/doc-list";
import type { ColumnKey } from "./ContractCells";

const TD = "px-3 py-3";
/** Nhãn loại chứng từ: HĐ nguyên tắc / Giao dịch (HĐ kinh tế không nhãn riêng, đã có Mua/Bán/Giới thiệu). */
export function DocTypeTag({ doc }: { doc: DocType | undefined }) {
  const { t } = useTranslation();
  return doc === "framework" || doc === "deal" ? (
    <Tag tone="grey">{t(`contracts.doclist.type.${doc}`)}</Tag>
  ) : null;
}

const statusText = (t: (k: string) => string, s: string): string => {
  const key = `contracts.gape.status.${s}`;
  const v = t(key);
  return v === key ? s : v;
};

/** Hàng con thụt dưới HĐ nguyên tắc (bảng): tên + số, nhãn loại, giá trị, trạng thái; bấm mở chứng từ con. */
export function ChildRowCells({
  child,
  orphan,
  shown,
}: {
  child: ListFrameChild;
  orphan: boolean;
  shown: readonly ColumnKey[];
}) {
  const { t } = useTranslation();
  return (
    <>
      {shown.map((k) => {
        switch (k) {
          case "title":
            return (
              <td key={k} className="max-w-[260px] px-3 py-2.5 pl-5">
                <Link
                  to="/contracts/$id"
                  params={{ id: child.id }}
                  className={cn("block truncate", orphan ? "font-semibold" : "pl-6")}
                  title={child.title}
                  data-testid={orphan ? "child-orphan" : "child-title"}
                  onClick={(e) => e.stopPropagation()}
                >
                  {!orphan && <span aria-hidden="true">↳ </span>}
                  {child.title}
                </Link>
                {child.number && (
                  <span className={cn("block truncate text-[12.5px] text-dim", !orphan && "pl-6")}>
                    {child.number}
                  </span>
                )}
              </td>
            );
          case "type":
            return (
              <td key={k} className={cn("whitespace-nowrap", TD)}>
                <DocTypeTag doc={child.doc_type} />
              </td>
            );
          case "value":
            return (
              <td key={k} className={cn("text-right font-mono whitespace-nowrap", TD)}>
                {child.value != null ? (
                  `${vnd(child.value)} đ`
                ) : (
                  <span className="text-dim">—</span>
                )}
              </td>
            );
          case "stage":
            return (
              <td key={k} className={cn("min-w-[150px]", TD)}>
                <Tag tone="grey">{statusText(t, child.status)}</Tag>
              </td>
            );
          default:
            return <td key={k} className={TD} />;
        }
      })}
      <td className="px-3 py-2.5 pr-5 text-right whitespace-nowrap">
        <Link
          to="/contracts/$id"
          params={{ id: child.id }}
          className="btn-icon-ghost"
          aria-label={t("contracts.list.viewContract")}
          title={t("contracts.list.viewContract")}
          onClick={(e) => e.stopPropagation()}
        >
          <EyeIcon />
        </Link>
      </td>
    </>
  );
}

/** Thẻ điện thoại của hàng con. */
export function ChildCard({ child, orphan }: { child: ListFrameChild; orphan: boolean }) {
  const { t } = useTranslation();
  return (
    <li className="border-b border-rule-soft last:border-0">
      <Link
        to="/contracts/$id"
        params={{ id: child.id }}
        className={cn("flex flex-col gap-1 py-3 pr-4 hover:bg-sunk", orphan ? "pl-4" : "pl-9")}
      >
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">
            {!orphan && <span aria-hidden="true">↳ </span>}
            {child.title}
          </span>
          <DocTypeTag doc={child.doc_type} />
        </span>
        <span className="text-[13px] text-dim">
          {[
            child.number,
            child.value != null ? `${vnd(child.value)} đ` : null,
            statusText(t, child.status),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </Link>
    </li>
  );
}

export const EyeIcon = () => (
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
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
