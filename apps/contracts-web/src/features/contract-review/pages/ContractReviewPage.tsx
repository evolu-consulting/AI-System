// HD-FR-22 · HD-FR-23 · HD-FR-26 · S05 · V2-F (HD-04 · HD-09 · HD-11 · mockup NITI "chi tiết hợp đồng"): trang HĐ — tiêu đề + dòng phụ theo
// trạng thái, "Xem file gốc", thẻ duyệt (HD3), hai cột: [Thông tin · Sản phẩm] | [Dòng thời gian mốc · Tóm tắt]; "Ghi việc" (HD7) cuối trang.
// Bước xác nhận sau upload (`needs_review`) dùng thanh Hủy/Lưu dính như form nhập tay. Đang đọc ⇒ tải lại mỗi 2 s.
import type { ContractDetail } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { AppendixPanel } from "~/features/appendix/AppendixPanel";
import { useApprovalUi } from "~/features/contract-approval/components/use-approval-ui";
import { DeadlinePanel } from "~/features/contract-deadline/components/DeadlinePanel";
import { todayIso } from "~/features/contract-deadline/lib/deadline";
import { dealOf } from "~/features/contract-form/lib/deal";
import { shortName } from "~/features/contracts-list/lib/list-model";
import { ContractLog } from "~/features/ledger/components/ContractLog";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { ContractSourcing } from "~/features/sourcing/components/ContractSourcing";
import { contractKey, fetchContract, fileHref, openOriginalFile } from "../api";
import { ContractHead } from "../components/ContractHead";
import { DetailGrid } from "../components/DetailGrid";
import { DetailLead } from "../components/DetailLead";
import { ExtractFailed, SaveNotice } from "../components/ReviewParts";
import { useInfoForm } from "../hooks/use-info-form";
import { leadKey } from "../lib/review";
import { saveErrorText } from "../lib/save-error";

const READING_REFRESH_MS = 2000;

/** Review m8 · giá trị + trích dẫn AI đọc cho thẻ duyệt cấp 1. */
const extractedOf = (c: ContractDetail | undefined) => {
  const f = c?.fields.total_value;
  return f ? { value: f.value, quote: f.quote ?? "", edited: f.edited === true } : undefined;
};

const partnerOf = (c: ContractDetail): string => {
  const v = c.fields[dealOf(c) === "buy" ? "supplier_name" : "buyer_name"]?.value;
  return typeof v === "string" ? shortName(v) : "";
};

const titleOf = (c: ContractDetail): string => {
  const v = c.fields.title.value;
  return (typeof v === "string" && v) || c.title;
};

type Info = ReturnType<typeof useInfoForm>;
type Approval = ReturnType<typeof useApprovalUi>;

function SaveButton({ info, ap, confirm }: { info: Info; ap: Approval; confirm: boolean }) {
  const { t } = useTranslation();
  const idle = t(confirm ? "contracts.common.save" : "contracts.cform.saveChanges");
  return (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      disabled={info.busy || ap.busy || !info.dirty}
      onClick={() => void info.save()}
    >
      {info.busy ? t("contracts.review.saving") : idle}
    </button>
  );
}

function ContractBody({
  id,
  c,
  info,
  ap,
}: {
  id: string;
  c: ContractDetail;
  info: Info & { f: NonNullable<Info["f"]> };
  ap: Approval;
}) {
  const { t } = useTranslation();
  const { write } = useMe();
  const [fileErr, setFileErr] = useState<string | null>(null);
  const confirm = c.status === "needs_review";
  const canSave = write && c.status !== "extracting";
  const key = leadKey(c.status);
  const lead = key ? t(key) : <DetailLead c={c} partner={partnerOf(c)} />;
  const openFile = () => {
    setFileErr(null);
    openOriginalFile(id).catch((e) => setFileErr(saveErrorText(e, t)));
  };
  const file = c.file ? { href: fileHref(id), name: c.file.name, onOpen: openFile } : null;
  const saveButton = canSave ? <SaveButton info={info} ap={ap} confirm={confirm} /> : null;
  return (
    // Thân trang như mgmt-app (`index.css:78-82`: 16 px, line-height 1.55) — Shell giữ thang chữ của nó.
    <div className="text-base leading-[1.55]">
      <ContractHead
        title={titleOf(c)}
        lead={lead}
        sticky={confirm && canSave}
        file={file}
        canSave={canSave}
        dirty={info.dirty}
        onReset={info.reset}
        saveButton={saveButton}
        approvalButtons={ap.buttons}
        approvalBusy={ap.busy}
      />
      <SaveNotice msg={info.msg ?? ap.msg} err={info.err ?? ap.err ?? fileErr} />
      {ap.section}
      <DeadlinePanel contract={c} write={write} queryKey={contractKey(id)} />
      {c.status === "extract_failed" ? (
        <ExtractFailed file={file} />
      ) : (
        <DetailGrid
          c={c}
          f={info.f}
          onSet={info.set}
          canSave={canSave}
          saveButton={confirm ? undefined : saveButton}
          write={write}
          partner={partnerOf(c)}
          today={todayIso()}
        />
      )}
      <AppendixPanel c={c} write={write} />
      <ContractSourcing c={c} write={write} />
      <ContractLog contractId={id} status={c.status} />
    </div>
  );
}

export function ContractReviewPage({ id }: { id: string }) {
  const { write } = useMe();
  const q = useQuery({
    queryKey: contractKey(id),
    queryFn: ({ signal }) => fetchContract(id, signal),
    refetchInterval: (s) => (s.state.data?.status === "extracting" ? READING_REFRESH_MS : false),
  });
  const info = useInfoForm(q.data, id);
  const ap = useApprovalUi({
    id,
    contractKey: contractKey(id),
    write,
    hasSource: q.data?.has_source ?? false,
    saveFirst: info.saveFirst,
    extracted: extractedOf(q.data),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data || !info.f) return <ErrorLine error={q.error} />;
  return <ContractBody id={id} c={q.data} info={{ ...info, f: info.f }} ap={ap} />;
}
