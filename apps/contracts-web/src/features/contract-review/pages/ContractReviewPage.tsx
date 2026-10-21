// HD-FR-22 · HD-FR-23 · HD-FR-26 · S05 · V2-F (HD-04 · HD-09 · HD-11 · mockup NITI "chi tiết hợp đồng"): trang HĐ — tiêu đề + dòng phụ theo
// trạng thái, "Xem file gốc", thẻ duyệt (HD3), hai cột: [Thông tin · Sản phẩm] | [Dòng thời gian mốc · Tóm tắt]; "Ghi việc" (HD7) cuối trang.
// Bước xác nhận sau upload (`needs_review`) dùng thanh Hủy/Lưu dính như form nhập tay. Đang đọc ⇒ tải lại mỗi 2 s.
import type { ContractDetail } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { AppendixPanel } from "~/features/appendix/AppendixPanel";
import { useApprovalUi } from "~/features/contract-approval/components/use-approval-ui";
import { DeadlinePanel } from "~/features/contract-deadline/components/DeadlinePanel";
import { todayIso } from "~/features/contract-deadline/lib/deadline";
import { DeleteContractButton } from "~/features/contract-delete/components/DeleteContractButton";
import { dealOf } from "~/features/contract-form/lib/deal";
import { AskContractPanel } from "~/features/contract-source/components/AskContractPanel";
import { SourceViewerContext } from "~/features/contract-source/components/QuoteLine";
import { SourcePanel } from "~/features/contract-source/components/SourcePanel";
import { shortName } from "~/features/contracts-list/lib/list-model";
import { ContractLog } from "~/features/ledger/components/ContractLog";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { ContractSourcing } from "~/features/sourcing/components/ContractSourcing";
import { contractKey, fetchContract, fileHref, openOriginalFile } from "../api";
import { ContractHead } from "../components/ContractHead";
import { DetailGrid } from "../components/DetailGrid";
import { DetailLead } from "../components/DetailLead";
import { HistoryPanel } from "../components/HistoryPanel";
import { ManagePanel } from "../components/ManagePanel";
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
  const { write, owner } = useMe();
  const [fileErr, setFileErr] = useState<string | null>(null);
  const confirm = c.status === "needs_review";
  const canSave = write && c.status !== "extracting";
  const key = leadKey(c.status);
  const lead = key ? t(key) : <DetailLead c={c} partner={partnerOf(c)} />;
  // Nút chỉ có khi HĐ có tệp gốc (nhập tay ⇒ không có); phụ lục có tệp riêng xem trong hộp thoại.
  const file = c.file
    ? { href: fileHref(id), name: c.file.name, onOpen: () => setOrigOpen(true) }
    : null;
  const saveButton = canSave ? <SaveButton info={info} ap={ap} confirm={confirm} /> : null;
  // gap-a2 #3: khoang văn bản gốc (mở bằng nút hoặc bằng "Xem đoạn này trong văn bản gốc" ở trích dẫn AI).
  const [src, setSrc] = useState<{ quote: string | null; nonce: number } | null>(null);
  const viewer = useMemo(
    () =>
      c.has_source
        ? { show: (quote: string) => setSrc((s) => ({ quote, nonce: (s?.nonce ?? 0) + 1 })) }
        : null,
    [c.has_source],
  );
  const askable = c.status !== "extracting" && c.status !== "extract_failed";
  return (
    <SourceViewerContext.Provider value={viewer}>
      <div className="flex items-start gap-4 max-lg:flex-col">
        <div className="min-w-0 flex-1 max-lg:w-full">
          {/* Thân trang như mgmt-app (`index.css:78-82`: 16 px, line-height 1.55) — Shell giữ thang chữ của nó. */}
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
            {viewer && (
              <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  className="btn btn-outline"
                  aria-pressed={src !== null}
                  onClick={() => setSrc((s) => (s ? null : { quote: null, nonce: 0 }))}
                >
                  {t("contracts.assistant.srcToggle")}
                </button>
              </div>
            )}
            <DeadlinePanel contract={c} write={write} queryKey={contractKey(id)} />
            <ManagePanel c={c} write={write} />
            {c.status === "extract_failed" ? (
              <ExtractFailed file={file} id={id} write={write} />
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
                info={info}
              />
            )}
            {askable && (
              <div className="mt-4">
                <AskContractPanel />
              </div>
            )}
            <AppendixPanel c={c} write={write} />
            <ContractSourcing c={c} write={write} />
            <ContractLog contractId={id} status={c.status} />
            <HistoryPanel id={id} />
            {owner && c.status !== "extracting" && (
              <div className="mt-6 flex justify-end">
                <DeleteContractButton id={id} />
              </div>
            )}
          </div>
        </div>
        {src && viewer && (
          <div className="sticky top-4 w-[420px] shrink-0 max-lg:static max-lg:w-full">
            <SourcePanel id={id} quote={src.quote} nonce={src.nonce} onClose={() => setSrc(null)} />
          </div>
        )}
      </div>
    </SourceViewerContext.Provider>
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
