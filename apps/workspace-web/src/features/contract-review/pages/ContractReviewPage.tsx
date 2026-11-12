// CR-127 · U5 · M9/M10: trang chi tiết HĐ — nạp HĐ (tải lại mỗi 2 s khi AI đang đọc) + thẻ duyệt; thân trang ở `ContractBody`.
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { useApprovalUi } from "~/features/contract-approval/components/use-approval-ui";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { contractKey, fetchContract } from "../api";
import { ContractBody } from "../components/ContractBody";
import { useInfoForm } from "../hooks/use-info-form";
import { detailErrorKey } from "../lib/load-error";

const READING_REFRESH_MS = 2000;

/** Review m8 · giá trị + trích dẫn AI đọc cho thẻ duyệt cấp 1. */
const extractedOf = (c: ContractDetail | undefined) => {
  const f = c?.fields.total_value;
  return f ? { value: f.value, quote: f.quote ?? "", edited: f.edited === true } : undefined;
};

export function ContractReviewPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const { write, owner } = useMe();
  const q = useQuery({
    queryKey: contractKey(id),
    queryFn: ({ signal }) => fetchContract(id, signal),
    refetchInterval: (s) =>
      s.state.data?.extract_state === "reading" ? READING_REFRESH_MS : false,
  });
  const info = useInfoForm(q.data, id);
  const ap = useApprovalUi({
    id,
    contractKey: contractKey(id),
    write,
    owner,
    hasSource: q.data?.has_source ?? false,
    saveFirst: info.saveFirst,
    extracted: extractedOf(q.data),
  });
  if (q.isLoading) return <Loading />;
  const hidden = detailErrorKey(q.error);
  if (hidden)
    return (
      <EmptyState
        kind="notFound"
        title={t(hidden)}
        titleTestId="contract-not-visible"
        action={
          <Link to="/contracts/list" className="text-act hover:underline">
            {t("contracts.review.toList")}
          </Link>
        }
      />
    );
  if (q.error || !q.data || !info.f) return <ErrorLine error={q.error} />;
  return <ContractBody id={id} c={q.data} info={{ ...info, f: info.f }} ap={ap} />;
}
