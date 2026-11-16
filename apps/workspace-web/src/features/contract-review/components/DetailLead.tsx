// V2-F · HD-04 · mockup `renderCDetail`: dòng phụ dưới tên HĐ — số hợp đồng · nhãn loại (Mua/Bán/Giới thiệu) · đối tác.
// CR-101 R33: thêm nhãn loại chứng từ (HĐ kinh tế / HĐ nguyên tắc / Giao dịch) + liên kết "thuộc HĐ nguyên tắc" (không quyền xem ⇒ nhãn riêng)
// + dòng File ký (HĐ) hoặc Tệp (giao dịch).
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { MetaList } from "@ai/web-kit/ui/kit/meta-list";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TruncText } from "~/components/shared/TruncText";
import { Tag } from "~/components/shared/tag";
import { DEAL_TONE, dealOf } from "~/features/contract-form/lib/deal";
import { frameLinkOf } from "~/features/frame-panel/lib/frame-view";
import { bareLabel, showFileItem } from "../lib/lead-items";

/** Mục «thuộc HĐ nguyên tắc»: nhãn + liên kết (không quyền xem ⇒ nhãn riêng). */
function frameItem(doc: ContractDetail["doc"], belongs: string, restricted: string) {
  const link = frameLinkOf(doc);
  if (!link) return null;
  if (link.kind === "restricted")
    return { label: belongs, value: <span data-testid="frame-ref-restricted">{restricted}</span> };
  return {
    label: belongs,
    value: (
      <Link
        to="/contracts/c/$id"
        params={{ id: link.id }}
        className="font-medium text-act hover:underline"
        data-testid="frame-ref"
      >
        {link.number ? `${link.number} · ` : ""}
        {link.title}
      </Link>
    ),
  };
}

/** CR-168/CR-180: dòng thông tin có nhãn («Số HĐ 1 · Loại Bán …» ở desktop; «nhãn: giá trị» từng dòng ở điện thoại). */
export function DetailLead({
  c,
  partner,
  owner,
  file,
  record,
}: {
  c: ContractDetail;
  partner: string;
  /** Nút xem file gốc (cạnh tên file ký). */
  file?: ReactNode;
  /** Nút «Hồ sơ» của file (một mục riêng). */
  record?: ReactNode;
  /** Mục «Phụ trách» (cuối dòng). */
  owner?: ReactNode;
}) {
  const { t } = useTranslation();
  const deal = dealOf(c);
  const n = c.fields.number?.value;
  const type = c.doc?.doc_type ?? "contract";
  const fileLabel = bareLabel(
    t(type === "deal" ? "contracts.docframe.fileDeal" : "contracts.docframe.fileSigned"),
  );
  const frame = frameItem(
    c.doc,
    t("contracts.docframe.belongs"),
    t("contracts.docframe.restricted"),
  );
  return (
    <div data-testid="detail-lead">
      <MetaList
        className="text-sm text-dim sm:[&_dt]:not-sr-only"
        items={[
          { label: t("contracts.review.lead.number"), value: typeof n === "string" ? n : null },
          {
            label: t("contracts.review.lead.type"),
            value: <Tag tone={DEAL_TONE[deal]}>{t(`contracts.cform.dealName.${deal}`)}</Tag>,
          },
          {
            label: t("contracts.review.lead.partner"),
            value: partner ? <TruncText maxWidth="16rem">{partner}</TruncText> : null,
          },
          ...(frame ? [frame] : []),
          {
            label: fileLabel,
            value: showFileItem(type, !!c.doc, !!c.file) ? (
              <span
                data-testid="doc-file-line"
                className="inline-flex min-w-0 max-w-full items-center gap-1"
              >
                <TruncText title={c.file?.name ?? ""} className="max-w-[24rem]">
                  {c.file ? c.file.name : t("contracts.docframe.noFile")}
                </TruncText>
                {file}
              </span>
            ) : null,
          },
          { label: t("contracts.review.lead.record"), value: record },
          { label: t("contracts.u5.owner.label"), value: owner },
        ]}
      />
    </div>
  );
}
