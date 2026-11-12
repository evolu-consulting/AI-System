// CR-127 · U4 · K8 · spec §8 #65 · HĐ đối tác gửi tới mà công ty CHƯA có quy trình nhận: người phụ trách quyết ngay trên dòng.
// Tiêu đề «Đối tác {công ty} gửi hợp đồng — bạn quyết định», 3 nút Đồng ý · Trả lại để sửa · Từ chối (Trả lại/Từ chối cần ý kiến).
import type { InboxDecisionValue } from "@ai/contracts/pack-contracts";
import { ApiError } from "@ai/web-kit/http";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EvidenceAsk } from "~/platform/flow";
import { cr127ErrorKey } from "~/platform/flow/lib/claim";
import { notifyFlowNavChanged } from "~/shared/kernel/flow-nav-event";
import { overviewKeys, postInboxDecision } from "../api";

const RULE = { mode: "opinion", signature: false, files: false } as const;

export function InboxDecisionRow({ contractId, sender }: { contractId: string; sender: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [ask, setAsk] = useState<"return" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (decision: InboxDecisionValue, evidence?: { note: string }) => {
    setBusy(true);
    setErr(null);
    try {
      await postInboxDecision(contractId, { decision, ...(evidence ? { evidence } : {}) });
      await qc.invalidateQueries({ queryKey: overviewKeys.approvals });
      notifyFlowNavChanged();
    } catch (e) {
      const k = e instanceof ApiError ? cr127ErrorKey(e.code as string) : null;
      setErr(k ? t(k) : t("contracts.errors.unknown"));
    } finally {
      setBusy(false);
    }
  };
  const label = (k: "return" | "reject") => t(`contracts.work.u4.inbox.${k}`);
  return (
    <div data-testid="inbox-decision-row" className="px-5 py-3 max-sm:px-4">
      <p className="m-0 text-[14.5px] font-semibold">
        {t("contracts.work.u4.inbox.title", { sender })}
      </p>
      <p className="mb-2 mt-0 text-caption text-dim">{t("contracts.work.u4.inbox.note")}</p>
      {ask ? (
        <EvidenceAsk
          action={{
            key: ask,
            label: label(ask),
            style: ask === "reject" ? "danger" : "default",
            confirm: false,
            input: { kind: "none" },
          }}
          rule={RULE}
          busy={busy}
          onCancel={() => setAsk(null)}
          onSend={(b) => void send(ask, { note: b.note }).then(() => setAsk(null))}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="inbox-accept"
            disabled={busy}
            onClick={() => void send("accept")}
          >
            {t("contracts.work.u4.inbox.accept")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="inbox-return"
            disabled={busy}
            onClick={() => setAsk("return")}
          >
            {label("return")}
          </button>
          <button
            type="button"
            className="btn btn-sm border border-late text-late"
            data-testid="inbox-reject"
            disabled={busy}
            onClick={() => setAsk("reject")}
          >
            {label("reject")}
          </button>
          <Link
            to="/contracts/c/$id"
            params={{ id: contractId }}
            className="text-caption text-act hover:underline"
          >
            {t("contracts.work.u4.inbox.open")}
          </Link>
        </div>
      )}
      {err && (
        <p role="alert" className="mt-2 text-sm text-late" data-testid="inbox-decision-error">
          {err}
        </p>
      )}
    </div>
  );
}
