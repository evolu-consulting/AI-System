// CR-127 · U5 · M9/M10 · thân trang chi tiết HĐ (tách khỏi `ContractReviewPage`): một đầu trang + băng lý do, 4 ô số, các mốc thực hiện ở giữa,
// thông tin + sản phẩm | Điều cần lưu ý · Cần chú ý · Hiệu lực · hồ sơ duyệt. Chỉ DRAFT là form; PROCESSING/DONE/REJECT hiện chữ đọc.
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApprovalUi } from "~/features/contract-approval/components/use-approval-ui";
import { decideOnly } from "~/features/contract-approval/lib/approval";
import { EsignPanel } from "~/features/contract-esign/components/EsignPanel";
import { SignSessionCard } from "~/features/contract-esign/components/SignSessionCard";
import { dealOf } from "~/features/contract-form/lib/deal";
import { lockView } from "~/features/contract-lock/lib/lock-view";
import { MilestoneList } from "~/features/contract-milestones/components/MilestoneList";
import { todayIso } from "~/features/contract-shared/lib/date";
import { VersionsPanels } from "~/features/contract-versions/components/VersionsPanels";
import { versionGate } from "~/features/contract-versions/lib/versions";
import { ExtractDialog } from "~/features/contracts-list/components/ExtractDialog";
import { shortName } from "~/features/contracts-list/lib/list-model";
import { FramePanel } from "~/features/frame-panel/components/FramePanel";
import { ContractLog } from "~/features/ledger/components/ContractLog";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { PartnerSendPanel } from "~/features/partner-inbox/components/PartnerSendPanel";
import { ProductLinkDialog } from "~/features/product-links/components/ProductLinkDialog";
import { EditLogPanel } from "~/features/promote-deal/components/EditLogPanel";
import { PromoteDeal } from "~/features/promote-deal/components/PromoteDeal";
import { contractKey, fileHref } from "../api";
import type { useInfoForm } from "../hooks/use-info-form";
import { headRule } from "../lib/head-rule";
import { saveLabelKey } from "../lib/review";
import { ContractHead } from "./ContractHead";
import { DetailGrid } from "./DetailGrid";
import { DetailLead } from "./DetailLead";
import { EffectCard, NoticeCards, StatsRow } from "./DetailSections";
import { HeadActions } from "./HeadActions";
import { HeadBanner } from "./HeadBanner";
import { HistoryPanel } from "./HistoryPanel";
import { LegalBanner } from "./LegalBanner";
import { ManagePanel, OwnerRow } from "./ManagePanel";
import { OriginalFileHost } from "./OriginalFileDialog";
import { ExtractFailed, FileLink, SaveNotice } from "./ReviewParts";
import { SubmitPreview } from "./SubmitPreview";

type Info = ReturnType<typeof useInfoForm>;

const partnerOf = (c: ContractDetail): string => {
  const v = c.fields[dealOf(c) === "buy" ? "supplier_name" : "buyer_name"]?.value;
  return typeof v === "string" ? shortName(v) : "";
};

/** Gập khối sửa (native `<details>`) khi người duyệt chỉ cần quyết; không gập ⇒ giữ nguyên bố cục. */
function Fold({ on, label, children }: { on: boolean; label: string; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <details data-testid="detail-fold" className="mb-4 rounded-xl border border-line px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold">{label}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function SaveButton({ info, ap, confirm }: { info: Info; ap: ApprovalUi; confirm: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={info.busy || ap.busy || (!confirm && !info.dirty)}
        onClick={() => void info.save()}
      >
        {info.busy ? t("contracts.review.saving") : t(saveLabelKey(confirm))}
      </button>
    </>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 U5 — luật hiển thị gom một chỗ, tách sau khi UI đóng băng
export function ContractBody(p: {
  id: string;
  c: ContractDetail;
  info: Info & { f: NonNullable<Info["f"]> };
  ap: ApprovalUi;
}) {
  const { id, c, info, ap } = p;
  const { t } = useTranslation();
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { sup, write } = versionGate(c, me);
  const [origOpen, setOrigOpen] = useState(false);
  const lock = lockView(c);
  const today = todayIso();
  const partner = partnerOf(c);
  useEffect(() => {
    if (ap.msg) toast(ap.msg);
  }, [ap.msg]);
  const rule = headRule({
    status: c.status,
    extractState: c.extract_state,
    round: c.submit_round,
    superseded: sup !== null,
    write,
    can: c.can,
    hold: c.hold !== null,
    approvalLoaded: ap.loaded,
    approvalStep: ap.step,
    approvalConfirm: ap.view.confirm,
    edited: info.edited,
    submitted: ap.submitted,
    submitBlock: c.submit_block ?? null,
    awaitingDecision: (c as { awaiting_decision?: boolean }).awaiting_decision,
  });
  const confirm = c.status === "draft" && c.submit_round === 0 && !ap.submitted;
  const { canSave } = rule;
  const reviewer = decideOnly(ap.view, c.status);
  const file = c.file
    ? { href: fileHref(id), name: c.file.name, onOpen: () => setOrigOpen(true) }
    : null;
  const saveButton = canSave ? <SaveButton info={info} ap={ap} confirm={confirm} /> : null;
  const refresh = () => void qc.invalidateQueries({ queryKey: contractKey(id) });
  const lead = (
    <DetailLead
      c={c}
      partner={partner}
      file={file ? <FileLink file={file} title={file.name} /> : null}
      owner={<OwnerRow c={c} write={write && c.status !== "reject"} />}
    />
  );
  const right = (
    <>
      <NoticeCards c={c} />
      <EffectCard c={c} today={today} />
    </>
  );
  const reading = c.extract_state === "reading" && c.status === "draft" && c.submit_round === 0;
  return (
    <div className="flex items-start gap-4 max-lg:flex-col">
      <div className="min-w-0 flex-1 max-lg:w-full">
        <div className="text-base leading-[1.55]">
          <ContractHead
            c={c}
            title={c.title}
            lead={lead}
            sticky={rule.sticky}
            onCancel={() =>
              rule.cancel === "reset" ? info.reset() : void nav({ to: "/contracts/list" })
            }
            saveButton={rule.draftSave ? saveButton : null}
            actions={
              <HeadActions
                id={id}
                rule={rule}
                saveFirst={info.saveFirst}
                onChanged={refresh}
                canDelete={c.can.delete === true}
                approval={{
                  ...ap.act,
                  view: ap.view,
                  busy: ap.busy || info.busy,
                  pageConfirm: () => void info.confirmSave.start(),
                }}
              />
            }
          />
          {confirm && (
            <p data-testid="draft-hint" className="-mt-3 mb-3 text-caption text-dim">
              {t("contracts.review.draftHint")}
            </p>
          )}
          {rule.submitBlocked && (
            <p role="status" data-testid="submit-blocked" className="mb-3 text-sm text-late">
              {t("contracts.u5.err.NO_APPROVAL_FLOW")}
            </p>
          )}
          {(rule.confirmSave || rule.draftSave || rule.resubmit) && !rule.submitBlocked && (
            <SubmitPreview id={id} version={c.version} />
          )}
          <HeadBanner kind={rule.banner} c={c} partner={partner} />
          <ExtractDialog open={reading} name={c.file?.name ?? c.title} />
          <PartnerSendPanel id={id} write={write} />
          <SignSessionCard id={id} write={write} />
          <EsignPanel id={id} locked={c.status === "done"} write={write} />
          <VersionsPanels id={id} versions={c.versions} sup={sup} />
          <SaveNotice err={info.err ?? ap.err} />
          <StatsRow c={c} today={today} />
          {c.doc?.doc_type !== "framework" && (
            <MilestoneList
              c={c}
              partner={partner}
              write={write}
              today={today}
              superseded={sup !== null}
            />
          )}
          {ap.section}
          <HistoryPanel id={id} />
          <ProductLinkDialog
            target={info.confirmSave.target}
            busy={info.confirmSave.busy}
            onCancel={info.confirmSave.cancel}
            onConfirm={(links) => void info.confirmSave.confirmLinks(links)}
          />
          <FramePanel c={c} write={write} />
          <LegalBanner warning={c.legal_warning} />
          {c.doc?.doc_type === "deal" && write && !sup && (
            <div className="mb-4 flex justify-end">
              <PromoteDeal id={id} />
            </div>
          )}
          <Fold on={reviewer} label={t("contracts.review.foldEdit")}>
            <ManagePanel c={c} write={write} />
            {c.extract_state === "failed" && c.status === "draft" ? (
              <ExtractFailed file={file} id={id} write={write} error={c.error} />
            ) : (
              <DetailGrid
                c={c}
                f={info.f}
                onSet={info.set}
                canSave={canSave}
                saveButton={confirm ? undefined : saveButton}
                write={write}
                partner={partner}
                today={today}
                info={info}
                lockedKeys={lock.lockedKeys}
                right={right}
              />
            )}
          </Fold>
          <OriginalFileHost
            open={origOpen}
            contractId={id}
            file={c.file}
            hasSource={c.has_source}
            appendices={c.appendices}
            onClose={() => setOrigOpen(false)}
          />
          <ContractLog contractId={id} status={c.status} />
          {c.doc?.doc_type === "deal" && <EditLogPanel id={id} />}
        </div>
      </div>
    </div>
  );
}
