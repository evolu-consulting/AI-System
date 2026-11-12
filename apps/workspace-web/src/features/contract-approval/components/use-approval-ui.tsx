// HD-FR-36 · S05: ghép thẻ duyệt cho trang kiểm/sửa — nút trên tiêu đề + khối dưới tiêu đề (ghi chú / lý do), giữ trang gọn.
// `saveFirst` (trang cấp) lưu ô đã đổi trước khi "Xác nhận" như mgmt-app.
// products-confirm: "Xác nhận"/"Duyệt" mà máy chủ báo sẽ xác nhận HĐ (`finalizes_on_approve`) ⇒ (lưu ô đã đổi) ⇒ hộp "Gắn sản phẩm"
// ⇒ gửi lựa chọn cùng `approve`. Bước chỉ chuyển cấp 2 / HĐ không có dòng hàng ⇒ duyệt thẳng như trước.

import type { EvidenceInput } from "@ai/contracts/chat";
import type { ProductLink } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchProducts } from "~/features/contract-form/hooks/use-form-api";
import { fetchContract } from "~/features/contract-review/hooks/use-review-api";
import { usePeople } from "~/features/contracts-list/hooks/use-people";
import {
  ProductLinkDialog,
  type ProductLinkTarget,
} from "~/features/product-links/components/ProductLinkDialog";
import {
  ClaimBar,
  claimView,
  decisionTaskOf,
  EvidenceAsk,
  evidenceRuleOf,
  useFlowView,
} from "~/platform/flow";
import { useApproval } from "../hooks/use-approval";
import { fetchApproval } from "../hooks/use-approval-api";
import {
  type ActResult,
  type ApprovalView,
  afterConfirm,
  canDecide,
  showLinkDialog,
  submittedAfter,
  viewAfterConfirm,
} from "../lib/approval";
import { releaseNoteKey } from "../lib/engine-card";
import { APPROVAL_SLOT } from "../lib/flow-view";
import { isDraftConfirm, movedToDueHours, movedToStep } from "../lib/moved-to";
import { ApprovalNote, ExtractedValue, ReasonForm } from "./ApprovalParts";
import { ApprovalRecord, ChangesSinceLast } from "./ApprovalRecord";
import { ApprovalTimeline } from "./ApprovalTimeline";
import { AttentionBanner } from "./AttentionBanner";

export type ApprovalUi = {
  /** CR-128 (e): thao tác của thẻ duyệt — đầu trang HĐ (HeadActions) vẽ nút chính + menu. */
  act: {
    onConfirm: () => void;
    onApprove: () => void;
    onAsk: (kind: "reject" | "return") => void;
  };
  section: ReactNode;
  busy: boolean;
  msg: string | null;
  err: string | null;
  view: ApprovalView;
  /** Đã tải trạng thái duyệt + bước hiện tại (null = tenant tắt duyệt / chưa có lượt) — cho luật nút đầu trang. */
  loaded: boolean;
  step: string | null;
  submitted: boolean;
};

/** CR-125 · UX H5 · "Đã gửi <bước> · hạn N giờ" (bước có hạn) hoặc "Đã chuyển: <bước>". */
function MovedText({ step, hours }: { step: string; hours: number | null }) {
  const { t } = useTranslation();
  return (
    <>
      {hours === null
        ? t("contracts.approval.done.movedTo", { step })
        : t("contracts.approval.done.movedToDue", { step, hours })}
    </>
  );
}

type LinkStep = { target: ProductLinkTarget; label: string | undefined };

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 U4 — luật hiển thị gom một chỗ, tách sau khi UI đóng băng
export function useApprovalUi(o: {
  id: string;
  contractKey: readonly unknown[];
  write: boolean;
  /** Owner/admin của gói: được "Mở lại quy trình" khi run engine kết thúc bất thường. */
  owner?: boolean;
  hasSource: boolean;
  saveFirst: () => Promise<void>;
  /** Giá trị HĐ AI đọc (trường `total_value`) — hiện ở cấp 1 cùng trích dẫn (review m8). */
  extracted?: { value: unknown; quote: string; edited: boolean } | undefined;
}): ApprovalUi {
  const { t } = useTranslation();
  const ap = useApproval(o.id, o.contractKey);
  // confirm-flow: "Đọc lại" (trích lại kèm lý do) ẩn theo người dùng 2026-10-23 ⇒ hộp lý do chỉ còn "Từ chối".
  const [ask, setAsk] = useState<"reject" | "return" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  // CR-127 · U4: việc nhóm (nhận việc) + ô bằng chứng của bước đang mở — đọc từ FlowView của hub (cùng khoá với dòng thời gian).
  const flow = useFlowView({ slot: APPROVAL_SLOT, refId: o.id });
  const task = flow.data ? decisionTaskOf(flow.data) : null;
  const cv = task ? claimView(task) : null;
  const people = usePeople(task !== null);
  const [ev, setEv] = useState<"approve" | "reject" | "return" | null>(null);
  const ruleOf = (key: string) =>
    evidenceRuleOf(task?.actions.find((a) => a.key === key)?.input, task?.evidence_mode, key);
  const v0 = viewAfterConfirm(ap.approval, confirmed, { write: o.write, hasSource: o.hasSource });
  // Chưa nhận / người khác đang giữ ⇒ khoá nút quyết (lý do hiện ở dải nhận việc ngay dưới).
  const v: ApprovalView = cv?.decideLocked
    ? { ...v0, confirm: false, approve: false, reject: false, pass: false, redo: false }
    : v0;
  const { link, setLink, approve, confirmLinks } = useConfirmFlow(o.id, ap, () =>
    setConfirmed(true),
  );
  // CR-120 · sau "Xác nhận và lưu" cho biết HĐ đã chuyển tới bước nào (engine tự mở bước kế theo luật; không có "Gửi duyệt" tay).
  const movedTo = confirmed ? movedToStep(ap.approval) : null;
  const actions = {
    onConfirm: () => void approve(o.saveFirst, "contracts.approval.done.confirm"),
    onApprove: () => (ruleOf("approve") ? setEv("approve") : void approve(undefined)),
    onAsk: (k: "reject" | "return") => (ruleOf(k) ? setEv(k) : setAsk(k)),
  };
  const rejected = ap.approval?.step === "rejected" ? ap.approval.feedback : null;
  // Run engine kết thúc bất thường (`needs_reopen`, lý do `ENGINE_RUN_*`): lượt GIỮ chế độ engine, chờ owner/admin mở lại.
  const stalled = ap.approval?.needs_reopen === true;
  // Lý do dừng bất thường ưu tiên hơn câu "đang chờ người duyệt" (run đã chết, không ai duyệt được).
  // CR-107: có `attention` ⇒ banner riêng thay cho ghi chú + nút Mở lại cũ (hub cũ không có `attention` ⇒ đường cũ).
  const attention = ap.approval?.attention ?? null;
  const note = attention
    ? null
    : stalled
      ? (releaseNoteKey(ap.approval?.feedback) ?? "contracts.approval.engine.release.OTHER")
      : v.note;
  const section = (
    <>
      {movedTo && (
        <p role="status" data-testid="moved-to" className="mb-3 text-label font-medium text-ok">
          <MovedText step={movedTo} hours={movedToDueHours(ap.approval, Date.now())} />
        </p>
      )}
      {ap.approval && (
        <ApprovalTimeline
          id={o.id}
          a={ap.approval}
          canAct={canDecide(v)}
          owner={o.owner === true}
        />
      )}
      {ap.approval?.mode === "engine" && (
        <>
          {ap.approval.step === "level1" || ap.approval.step === "level2" ? (
            <ChangesSinceLast id={o.id} />
          ) : null}
          <ApprovalRecord id={o.id} />
        </>
      )}
      {attention && <AttentionBanner attention={attention} />}
      <ApprovalNote note={note} rejected={rejected} />
      {rejected && !attention && (
        <p data-approval="rejected-next" className="mb-3 text-sm text-muted">
          {t("contracts.approval.rejectedNext")}
        </p>
      )}
      {v.confirm && o.extracted && <ExtractedValue {...o.extracted} />}
      {task && (
        <ClaimBar
          taskId={task.task_id}
          info={task}
          people={people}
          onChanged={() => {
            void flow.refetch();
            void ap.refresh();
          }}
        />
      )}
      {ev && ruleOf(ev) && (
        <div data-approval="evidence" className="mb-4 rounded-xl border border-line p-4">
          <EvidenceAsk
            action={
              task?.actions.find((a) => a.key === ev) ?? {
                key: ev,
                label: t(`contracts.approval.${ev}`),
                style: ev === "approve" ? "primary" : "default",
                confirm: false,
                input: { kind: "none" },
              }
            }
            rule={ruleOf(ev) as NonNullable<ReturnType<typeof ruleOf>>}
            busy={ap.busy !== null}
            onCancel={() => setEv(null)}
            onSend={async (body: EvidenceInput) => {
              const r =
                ev === "approve"
                  ? await approve(undefined, undefined, body)
                  : await ap.act({ action: ev, feedback: body.note, evidence: body });
              if (r !== false && !(typeof r === "object" && !r.ok)) setEv(null);
            }}
          />
        </div>
      )}
      {ask && (
        <ReasonForm
          kind={ask}
          busy={ap.busy}
          onCancel={() => setAsk(null)}
          onSubmit={async (feedback) => {
            if ((await ap.act({ action: ask, feedback })).ok) setAsk(null);
          }}
        />
      )}
      <ProductLinkDialog
        target={link?.target ?? null}
        busy={ap.busy !== null}
        onCancel={() => setLink(null)}
        onConfirm={(links) => void confirmLinks(links)}
      />
    </>
  );
  return {
    act: actions,
    section,
    busy: ap.busy !== null,
    msg: ap.msg,
    err: ap.err,
    view: v,
    loaded: ap.approval !== undefined,
    step: ap.approval?.step ?? null,
    /** P11e · đã gửi duyệt (không còn là nháp chờ "Xác nhận và lưu"). */
    submitted: submittedAfter(ap.approval, confirmed),
  };
}

/** "Xác nhận và lưu" / "Duyệt" ⇒ (lưu ô đã đổi) ⇒ (hộp "Gắn sản phẩm") ⇒ `approve`; kết quả đóng hộp + tải lại + báo. */
function useConfirmFlow(id: string, ap: ReturnType<typeof useApproval>, onConfirmed: () => void) {
  const { t } = useTranslation();
  const [link, setLink] = useState<LinkStep | null>(null);
  /** Kết quả "Xác nhận"/"Duyệt" ⇒ đóng hộp, tải lại, báo (cấp 2 ⇒ chờ BGĐ; bước đã đổi ⇒ câu rõ ràng). */
  const draft = useRef(false);
  const pendingEv = useRef<EvidenceInput | undefined>(undefined);
  const settle = async (r: ActResult): Promise<boolean> => {
    const next = afterConfirm(r);
    if (r.ok && draft.current) onConfirmed();
    if (next.close) setLink(null);
    if (next.toast) {
      ap.setMsg(t(next.toast));
      toast(t(next.toast));
    }
    if (!r.ok && next.refetch) {
      ap.setErr(t("contracts.approval.errors.changedReloaded"));
      await ap.refresh();
    }
    return r.ok;
  };
  const approve = async (
    before: (() => Promise<void>) | undefined,
    label?: string,
    evidence?: EvidenceInput,
  ) => {
    const ex = evidence ? { evidence } : {};
    pendingEv.current = evidence;
    draft.current = isDraftConfirm(ap.approval); // bước soạn ⇒ xác nhận xong báo bước kế
    // Bước này chưa xác nhận HĐ (cấp 1 ⇒ cấp 2) ⇒ duyệt thẳng, không hộp; người duyệt cấp 2 sẽ thấy hộp.
    if (!showLinkDialog(ap.approval, 1))
      return settle(await ap.act({ action: "approve", ...ex }, before, label));
    // Lưu ô đã đổi (KHÔNG mở lại lượt / đọc lại — sửa ở cấp 1 giữ lượt đang mở, D3-14) rồi đọc lại trạng thái duyệt MỚI: giá trị vừa
    // sửa có thể làm bước này chuyển cấp 2 thay vì xác nhận HĐ.
    const step0 = ap.approval?.step;
    const got = await ap.prepare(async () => {
      await before?.();
      return Promise.all([fetchContract(id), fetchProducts(), fetchApproval(id)]);
    });
    if (!got) return false;
    // Đã lưu ⇒ nạp lại HĐ (version mới cho form; Huỷ hộp rồi bấm lại không bị "đã bị sửa").
    if (before) await ap.refresh();
    const [c, products, fresh] = got;
    if (fresh.step !== step0 || !fresh.can_act || fresh.task_id !== ap.approval?.task_id)
      return settle({ ok: false, code: "APPROVAL_NOT_OPEN" });
    if (!showLinkDialog(fresh, c.items.length))
      return settle(await ap.act({ action: "approve", ...ex }, undefined, label));
    setLink({ target: { items: c.items, products, deal: c.deal }, label });
  };
  const confirmLinks = async (products: ProductLink[]) => {
    const r = await ap.act(
      {
        action: "approve",
        products,
        ...(pendingEv.current ? { evidence: pendingEv.current } : {}),
      },
      undefined,
      link?.label,
    );
    if (!r.ok && r.code === "IN_FLIGHT") return;
    await settle(r);
  };
  return { link, setLink, approve, confirmLinks };
}
