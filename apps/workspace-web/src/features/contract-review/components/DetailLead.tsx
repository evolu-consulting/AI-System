// V2-F · HD-04 · mockup `renderCDetail`: dòng phụ dưới tên HĐ — số hợp đồng · nhãn loại (Mua/Bán/Giới thiệu) · đối tác.
// CR-101 R33: thêm nhãn loại chứng từ (HĐ kinh tế / HĐ nguyên tắc / Giao dịch) + liên kết "thuộc HĐ nguyên tắc" (không quyền xem ⇒ nhãn riêng)
// + dòng File ký (HĐ) hoặc Tệp (giao dịch).
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MetaLine } from "~/components/shared/meta-line";
import { TruncText } from "~/components/shared/TruncText";
import { Tag } from "~/components/shared/tag";
import { DEAL_TONE, dealOf } from "~/features/contract-form/lib/deal";
import { frameLinkOf } from "~/features/frame-panel/lib/frame-view";

function FrameRef({ doc }: { doc: ContractDetail["doc"] }) {
  const { t } = useTranslation();
  const link = frameLinkOf(doc);
  if (!link) return null;
  if (link.kind === "restricted")
    return <span data-testid="frame-ref-restricted">{t("contracts.docframe.restricted")}</span>;
  return (
    <span>
      {t("contracts.docframe.belongs")}{" "}
      <Link
        to="/contracts/c/$id"
        params={{ id: link.id }}
        className="font-medium text-act hover:underline"
        data-testid="frame-ref"
      >
        {link.number ? `${link.number} · ` : ""}
        {link.title}
      </Link>
    </span>
  );
}

/** CR-168: mỗi mục dòng thông tin có nhãn rõ («Số HĐ 1», «Loại Bán», «Đối tác …»). */
function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 font-medium text-ink">{children}</span>
    </span>
  );
}

export function DetailLead({
  c,
  partner,
  owner,
  file,
}: {
  c: ContractDetail;
  partner: string;
  /** CR-128 (e): «Xem file gốc» nằm ở dòng thông tin (không còn nút đầu trang). */
  file?: ReactNode;
  /** Mục «Phụ trách» (cuối dòng, cùng phân cách). */
  owner?: ReactNode;
}) {
  const { t } = useTranslation();
  const deal = dealOf(c);
  const n = c.fields.number?.value;
  const type = c.doc?.doc_type ?? "contract";
  const fileLabel = t(
    type === "deal" ? "contracts.docframe.fileDeal" : "contracts.docframe.fileSigned",
  );
  return (
    <MetaLine>
      {typeof n === "string" && n ? (
        <Labeled label={t("contracts.review.lead.number")}>{n}</Labeled>
      ) : null}
      <Labeled label={t("contracts.review.lead.type")}>
        <Tag tone={DEAL_TONE[deal]}>{t(`contracts.cform.dealName.${deal}`)}</Tag>
      </Labeled>
      {partner ? (
        <Labeled label={t("contracts.review.lead.partner")}>
          <TruncText maxWidth="16rem">{partner}</TruncText>
        </Labeled>
      ) : null}
      {frameLinkOf(c.doc) ? <FrameRef doc={c.doc} /> : null}
      {c.doc && type !== "framework" ? (
        <span
          data-testid="doc-file-line"
          className="inline-flex max-w-[24rem] items-baseline gap-1"
        >
          <span className="shrink-0">{fileLabel}</span>
          <TruncText title={c.file?.name ?? ""}>
            {c.file ? c.file.name : t("contracts.docframe.noFile")}
          </TruncText>
        </span>
      ) : null}
      {file}
      {owner}
    </MetaLine>
  );
}
