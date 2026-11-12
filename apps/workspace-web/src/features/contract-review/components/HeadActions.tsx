// CR-127 · U5 · BR-02…04, 36a, 41/42 · M10 / CR-128 (e): đầu trang HĐ chỉ MỘT nút chính (theo `headActs`) + menu «Thao tác ▾» (mọi việc còn lại, Xoá cuối).
// Nút nào hiện/khoá do `can` của hub (đã tính quyền); lỗi nói cách khắc phục (câu VI §9). Hộp lý do/xác nhận mở từ mục menu.
import { ApiError } from "@ai/web-kit/http";
import { toast } from "@ai/web-kit/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PopItem } from "~/components/shared/pop-menu";
import { Btn } from "~/components/ui/Btn";
import type { ApprovalView } from "~/features/contract-approval/lib/approval";
import { ContractActionsMenu } from "~/features/contract-delete/components/ContractActionsMenu";
import { UploadVersionPanel } from "~/features/contract-versions/components/UploadVersionPanel";
import { evidenceBody } from "~/platform/flow";
import {
  execErrorKey,
  holdContract,
  recreateContract,
  releaseContract,
  submitContract,
  withdrawContract,
} from "../api-exec";
import { type HeadActKey, type HeadRule, headActs } from "../lib/head-rule";
import { type Ask, AskDialog, RULE } from "./AskDialog";

/** Thao tác của thẻ duyệt (từ `useApprovalUi`) + nút "Xác nhận và lưu" của trang. */
export type HeadApprovalActs = {
  view: ApprovalView;
  busy: boolean;
  onConfirm: () => void;
  onApprove: () => void;
  onAsk: (kind: "reject" | "return") => void;
  /** "Xác nhận và lưu" của trang (nháp lần đầu, tenant tắt duyệt). */
  pageConfirm: () => void;
};

export function HeadActions({
  id,
  rule,
  saveFirst,
  onChanged,
  approval,
  canDelete,
}: {
  id: string;
  rule: HeadRule;
  approval: HeadApprovalActs;
  canDelete: boolean;
  saveFirst: () => Promise<void>;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [ask, setAsk] = useState<Ask>(null);
  const [upload, setUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = async (msg: string) => {
    setAsk(null);
    toast(msg);
    await qc.invalidateQueries({ queryKey: ["contract", id] });
    await qc.invalidateQueries({ queryKey: ["contracts", "list"] });
    onChanged();
  };
  const run = async (f: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
      await done(okMsg);
    } catch (e) {
      const code = e instanceof ApiError ? (e.code as string) : undefined;
      if (code === "UNCHANGED_REASON_REQUIRED") setAsk("unchanged");
      const k = execErrorKey(code);
      setErr(k ? t(k, { who: "", status: "" }) : t("contracts.errors.unknown"));
    } finally {
      setBusy(false);
    }
  };
  const resubmit = (reason?: string) =>
    run(async () => {
      await saveFirst();
      await submitContract(id, reason ? { unchanged_reason: reason } : {});
    }, t("contracts.u5.toast.resubmitted"));
  const acts = headActs({ rule, view: approval.view, canDelete });
  const off = busy || approval.busy;
  const act: Record<
    Exclude<HeadActKey, "delete">,
    { label: string; run: () => void; attr?: string; testId: string }
  > = {
    approvalConfirm: {
      label: "contracts.approval.confirmSave",
      run: approval.onConfirm,
      testId: "act-approvalConfirm",
    },
    pageConfirm: {
      label: "contracts.approval.confirmSave",
      run: approval.pageConfirm,
      testId: "confirm-save",
    },
    approve: {
      label: "contracts.approval.approve",
      run: approval.onApprove,
      attr: "approve",
      testId: "act-approve",
    },
    pass: {
      label: "contracts.approval.pass",
      run: approval.onApprove,
      attr: "pass",
      testId: "act-pass",
    },
    back: {
      label: "contracts.approval.return",
      run: () => approval.onAsk("return"),
      attr: "return",
      testId: "act-return",
    },
    reject: {
      label: "contracts.approval.reject",
      run: () => approval.onAsk("reject"),
      attr: "reject",
      testId: "act-reject",
    },
    resubmit: {
      label: "contracts.u5.act.resubmit",
      run: () => void resubmit(),
      testId: "act-resubmit",
    },
    withdraw: {
      label: "contracts.u5.act.withdraw",
      run: () => setAsk("withdraw"),
      testId: "act-withdraw",
    },
    recreate: {
      label: "contracts.u5.act.recreate",
      testId: "act-recreate",
      run: () =>
        void run(async () => {
          const r = await recreateContract(id);
          await nav({ to: "/contracts/c/$id", params: { id: r.id } });
        }, t("contracts.u5.toast.recreated")),
    },
    newVersion: {
      label: "contracts.u5.act.newVersion",
      run: () => setUpload(true),
      testId: "act-newVersion",
    },
    hold: { label: "contracts.u5.act.hold", run: () => setAsk("hold"), testId: "act-hold" },
    release: {
      label: "contracts.u5.act.release",
      run: () => setAsk("release"),
      testId: "act-release",
    },
  };
  const items: PopItem[] = acts.menu
    .filter((m) => m.key !== "delete")
    .map((m) => {
      const a = act[m.key as Exclude<HeadActKey, "delete">];
      return {
        key: m.key,
        label: t(a.label),
        testId: a.testId,
        ...(a.attr ? { dataAttr: a.attr } : {}),
        ...(m.whyKey ? { disabled: true, why: t(m.whyKey) } : {}),
        onSelect: a.run,
      };
    });
  const main = acts.primary && acts.primary !== "delete" ? act[acts.primary] : null;
  return (
    <>
      {main && (
        <Btn
          variant="primary"
          size="sm"
          data-testid={main.testId}
          data-approval={main.attr}
          disabled={off}
          onClick={main.run}
        >
          {approval.busy && main.attr === "approve"
            ? t("contracts.approval.approving")
            : t(main.label)}
        </Btn>
      )}
      <ContractActionsMenu id={id} canDelete={canDelete} items={items} busy={off} />
      {err && !ask && (
        <span role="alert" className="text-sm text-late" data-testid="act-error">
          {err}
        </span>
      )}
      {ask && (
        <AskDialog
          kind={ask}
          busy={busy}
          err={err}
          onCancel={() => {
            setAsk(null);
            setErr(null);
          }}
          onOk={(reason, ev) => {
            if (ask === "unchanged") void resubmit(reason);
            else if (ask === "withdraw")
              void run(() => withdrawContract(id, { reason }), t("contracts.u5.toast.withdrawn"));
            else {
              const body = { reason: ev.note || reason, evidence: evidenceBody(ev, RULE) };
              void run(
                () => (ask === "hold" ? holdContract(id, body) : releaseContract(id, body)),
                t(ask === "hold" ? "contracts.u5.toast.held" : "contracts.u5.toast.released"),
              );
            }
          }}
        />
      )}
      <UploadVersionPanel contractId={id} open={upload} onClose={() => setUpload(false)} />
    </>
  );
}
