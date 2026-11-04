// V2-F · HD-04 · mockup `renderCDetail`: dòng phụ dưới tên HĐ — số hợp đồng · nhãn loại (Mua/Bán/Giới thiệu) · đối tác.
// CR-101 R33: thêm nhãn loại chứng từ (HĐ kinh tế / HĐ nguyên tắc / Giao dịch) + liên kết "thuộc HĐ nguyên tắc" (không quyền xem ⇒ nhãn riêng)
// + dòng File ký (HĐ) hoặc Tệp (giao dịch).
import type { ContractDetail } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Tag } from "~/components/shared/tag";
import { DEAL_TONE, dealOf } from "~/features/contract-form/lib/deal";
import { frameLinkOf } from "~/features/frame-panel/lib/frame-view";

function FrameRef({ doc }: { doc: ContractDetail["doc"] }) {
  const { t } = useTranslation();
  const link = frameLinkOf(doc);
  if (!link) return null;
  if (link.kind === "restricted")
    return <span data-testid="frame-ref-restricted">· {t("contracts.docframe.restricted")}</span>;
  return (
    <span>
      · {t("contracts.docframe.belongs")}{" "}
      <Link
        to="/contracts/$id"
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

export function DetailLead({ c, partner }: { c: ContractDetail; partner: string }) {
  const { t } = useTranslation();
  const deal = dealOf(c);
  const n = c.fields.number?.value;
  const type = c.doc?.doc_type ?? "contract";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {typeof n === "string" && n && <span>{n} ·</span>}
      {c.doc && (
        <Tag tone={type === "framework" ? "ok" : type === "deal" ? "soon" : "grey"}>
          <span data-testid="doc-type-tag">{t(`contracts.docframe.type.${type}`)}</span>
        </Tag>
      )}
      <Tag tone={DEAL_TONE[deal]}>{t(`contracts.cform.dealName.${deal}`)}</Tag>
      {partner && <span>· {partner}</span>}
      <FrameRef doc={c.doc} />
      {c.doc && type !== "framework" && (
        <span data-testid="doc-file-line">
          · {t(type === "deal" ? "contracts.docframe.fileDeal" : "contracts.docframe.fileSigned")}{" "}
          {c.file ? c.file.name : t("contracts.docframe.noFile")}
        </span>
      )}
    </span>
  );
}
