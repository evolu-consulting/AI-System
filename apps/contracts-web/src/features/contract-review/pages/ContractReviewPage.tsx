// HD-FR-22 · HD-FR-23 · HD-FR-26 · S05 · V2-F (HD-04 · HD-09 · HD-11 · mockup NITI "chi tiết hợp đồng"): trang HĐ — tiêu đề + dòng phụ theo
// trạng thái, "Xem file gốc", thẻ duyệt (HD3), hai cột: [Thông tin · Sản phẩm] | [Dòng thời gian mốc · Tóm tắt]; "Ghi việc" (HD7) cuối trang.
// Bước xác nhận sau upload (`needs_review`) dùng thanh Hủy/Lưu dính như form nhập tay. Đang đọc ⇒ tải lại mỗi 2 s.
import type { ContractDetail } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { toast } from "~/components/shared/toast";
import { useApprovalUi } from "~/features/contract-approval/components/use-approval-ui";
import { DeadlinePanel } from "~/features/contract-deadline/components/DeadlinePanel";
import { todayIso } from "~/features/contract-deadline/lib/deadline";
import { EsignPanel } from "~/features/contract-esign/components/EsignPanel";
import { dealOf } from "~/features/contract-form/lib/deal";
import { LockBanner } from "~/features/contract-lock/components/LockBanner";
import { lockView, reopenRight } from "~/features/contract-lock/lib/lock-view";
import { VersionsPanels } from "~/features/contract-versions/components/VersionsPanels";
import { versionGate } from "~/features/contract-versions/lib/versions";
import { ExtractDialog } from "~/features/contracts-list/components/ExtractDialog";
import { dialogOpen } from "~/features/contracts-list/lib/extract-progress";
import { shortName } from "~/features/contracts-list/lib/list-model";
import { FramePanel } from "~/features/frame-panel/components/FramePanel";
import { ContractLog } from "~/features/ledger/components/ContractLog";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { ProductLinkDialog } from "~/features/product-links/components/ProductLinkDialog";
import { EditLogPanel } from "~/features/promote-deal/components/EditLogPanel";
import { PromoteDeal } from "~/features/promote-deal/components/PromoteDeal";
import { ContractTxBlock } from "~/features/transactions/components/ContractTxBlock";
import { contractKey, fetchContract, fileHref } from "../api";
import { ContractHead } from "../components/ContractHead";
import { DetailGrid } from "../components/DetailGrid";
import { DetailLead } from "../components/DetailLead";
import { HistoryPanel } from "../components/HistoryPanel";
import { ManagePanel } from "../components/ManagePanel";
import { OriginalFileHost } from "../components/OriginalFileDialog";
import { ExtractFailed, SaveNotice } from "../components/ReviewParts";
import { useInfoForm } from "../hooks/use-info-form";
import { headRule } from "../lib/head-rule";
import { leadKey, saveLabelKey } from "../lib/review";

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
  const idle = t(saveLabelKey(confirm));
  return (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      disabled={info.busy || ap.busy || (!confirm && !info.dirty)}
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
  const me = useMe();
  // K3b: bản đã bị thay chỉ đọc hoàn toàn.
  const { sup, write, owner, canUpdate } = versionGate(c, me);
  const [origOpen, setOrigOpen] = useState(false);
  const lock = lockView(c, !sup && reopenRight(c, { owner, write, userId: me.user?.id }));
  const nav = useNavigate();
  // Thông báo thành công của thẻ duyệt ⇒ toast (không còn khối giữ chỗ trong trang).
  useEffect(() => {
    if (ap.msg) toast(ap.msg);
  }, [ap.msg]);
  const rule = headRule({
    status: c.status,
    locked: c.locked,
    write,
    approvalLoaded: ap.loaded,
    approvalStep: ap.step,
    approvalConfirm: ap.view.confirm,
    edited: info.edited,
  });
  const confirm = c.status === "needs_review";
  const { canSave } = rule;
  const key = leadKey(c.status);
  const lead = key ? t(key) : <DetailLead c={c} partner={partnerOf(c)} />;
  // Nút chỉ có khi HĐ có tệp gốc (nhập tay ⇒ không có); phụ lục có tệp riêng xem trong hộp thoại.
  const file = c.file
    ? { href: fileHref(id), name: c.file.name, onOpen: () => setOrigOpen(true) }
    : null;
  const saveButton = canSave ? <SaveButton info={info} ap={ap} confirm={confirm} /> : null;
  // "Xác nhận và lưu" khi tenant tắt duyệt (bật duyệt dùng nút của thẻ duyệt).
  const confirmButton = rule.confirmSave ? (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      data-testid="confirm-save"
      disabled={info.busy || ap.busy}
      onClick={() => void info.confirmSave.start()}
    >
      {t("contracts.approval.confirmSave")}
    </button>
  ) : null;
  // Người dùng 2026-10-23: bỏ nút + khoang "Văn bản gốc" khỏi trang (code `contract-source` giữ lại, chỉ không render).
  return (
    <div className="flex items-start gap-4 max-lg:flex-col">
      <div className="min-w-0 flex-1 max-lg:w-full">
        {/* Thân trang như mgmt-app (`index.css:78-82`: 16 px, line-height 1.55) — Shell giữ thang chữ của nó. */}
        <div className="text-base leading-[1.55]">
          <ContractHead
            title={titleOf(c)}
            lead={lead}
            sticky={rule.sticky}
            file={file}
            canSave={canSave}
            onCancel={() =>
              rule.cancel === "reset" ? info.reset() : void nav({ to: "/contracts" })
            }
            saveButton={rule.draftSave ? saveButton : null}
            confirmButton={confirmButton}
            approvalButtons={ap.buttons}
            approvalBusy={ap.busy}
          />
          <ExtractDialog
            open={dialogOpen({ uploading: false, status: c.status })}
            name={c.file?.name ?? titleOf(c)}
          />
          <LockBanner id={id} view={lock} canUpdate={canUpdate} />
          {/* cf-esign-docusign · ký số sau khi duyệt xong (đã khoá). */}
          <EsignPanel id={id} locked={c.locked === true} write={write} />
          <VersionsPanels id={id} versions={c.versions} sup={sup} />
          <SaveNotice err={info.err ?? ap.err} />
          {ap.section}
          {/* atomic-confirm: "Xác nhận và lưu" (tắt duyệt) ⇒ hộp "Gắn sản phẩm" ⇒ một POST /review mang `products`. */}
          <ProductLinkDialog
            target={info.confirmSave.target}
            busy={info.confirmSave.busy}
            onCancel={info.confirmSave.cancel}
            onConfirm={(links) => void info.confirmSave.confirmLinks(links)}
          />
          {/* CR-101 DOC-ui-frame: HĐ nguyên tắc ⇒ khối "Chứng từ con"; giao dịch ⇒ nút "Nâng thành hợp đồng". */}
          <FramePanel c={c} write={write} />
          {c.doc?.doc_type === "deal" && write && !sup && (
            <div className="mb-4 flex justify-end">
              <PromoteDeal id={id} />
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
              lockedKeys={lock.lockedKeys}
            />
          )}
          {/* ux-excel E3: bỏ "Hỏi về hợp đồng này" khỏi trang (còn "Trợ lý AI" nổi); mã tính năng giữ nguyên. */}
          <OriginalFileHost
            open={origOpen}
            contractId={id}
            file={c.file}
            hasSource={c.has_source}
            appendices={c.appendices}
            onClose={() => setOrigOpen(false)}
          />
          {/* ux-excel E3: bỏ "Phụ lục và giá" khỏi trang này (feature `appendix` giữ nguyên, chưa gắn). */}
          {/* Bỏ "Nguồn hàng & lãi" khỏi chi tiết HĐ (người dùng 2026-10-23); feature `sourcing` giữ nguyên, chưa gắn. */}
          <ContractLog contractId={id} status={c.status} />
          {c.doc?.doc_type === "deal" && <EditLogPanel id={id} />}
          <ContractTxBlock contractId={id} write={write} />
          <HistoryPanel id={id} />
          {/* "Xoá hợp đồng" chuyển sang biểu tượng thùng rác ở hàng danh sách (người dùng 2026-10-23). */}
        </div>
      </div>
    </div>
  );
}

export function ContractReviewPage({ id }: { id: string }) {
  const { write, owner } = useMe();
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
    owner,
    hasSource: q.data?.has_source ?? false,
    saveFirst: info.saveFirst,
    extracted: extractedOf(q.data),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data || !info.f) return <ErrorLine error={q.error} />;
  return <ContractBody id={id} c={q.data} info={{ ...info, f: info.f }} ap={ap} />;
}
