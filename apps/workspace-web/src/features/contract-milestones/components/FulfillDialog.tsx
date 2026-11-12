// CR-127 · U5 · BR-41…54 · M11 · spec §8: xác nhận một mốc đã thực hiện (đã giao / đã nhận tiền / đã trả) HOẶC dời hạn.
// Ngày thật + bằng chứng bắt buộc; trễ hạn ⇒ hỏi lỗi do ai; giao/thu thiếu ⇒ hỏi giữ hạn cũ hay tách mốc. Bảng "Giao đợt này" dùng lại `DeliveryLines`.

import type { ContractDeal, FulfillRequest, Milestone } from "@ai/contracts/pack-contracts";
import { ApiError } from "@ai/web-kit/http";
import { DateInput } from "@ai/web-kit/ui/DateInput";
import { toast } from "@ai/web-kit/ui/toast";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { parseMoney } from "~/components/shared/format";
import { PillRadio } from "~/components/shared/seg-button";
import { saveErrorText } from "~/features/contract-review/lib/save-error";
import {
  cr127ErrorKey,
  EMPTY_EVIDENCE,
  type EvidenceDraft,
  EvidenceInput,
  type EvidenceRule,
  evidenceBody,
  evidenceIssue,
  whoOf,
} from "~/platform/flow";
import { notifyFlowNavChanged } from "~/shared/kernel/flow-nav-event";
import { fulfillMilestone, requestChange } from "../api-exec";
import type { LinesEdit } from "../lib/delivery-lines";
import { isMoney } from "../lib/milestone-rows";
import { daysBetween } from "../lib/timeline";
import { DeliveryLines } from "./DeliveryLines";

const RULE: EvidenceRule = { mode: "opinion_plus", signature: true, files: true };
const FAULTS = ["partner", "ours", "unknown"] as const;

/** Mã lỗi ghi thực hiện ⇒ khoá i18n (§9); mã của lát nhận việc dùng bảng U4. */
export function fulfillErrorKey(code: string | undefined): string | null {
  const own = [
    "CONTRACT_ON_HOLD",
    "OVER_PLAN",
    "OBLIGATION_CLOSED",
    "CHANGE_PENDING",
    "CHANGE_PENDING_EXISTS",
    "CHANGE_INVALID",
    "CHANGE_FORBIDDEN",
    "USE_NEW_VERSION",
  ];
  if (code && own.includes(code)) return `contracts.u5.err.${code}`;
  return cr127ErrorKey(code);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 U5 — luật hiển thị gom một chỗ, tách sau khi UI đóng băng
export function FulfillDialog(p: {
  m: Milestone;
  mode: "fulfill" | "postpone";
  today: string;
  deal: ContractDeal | null;
  partner: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { m } = p;
  const post = p.mode === "postpone";
  const money = isMoney(m.kind);
  const full = m.amount_effective ?? m.amount ?? 0;
  const [at, setAt] = useState(post ? m.due_date : p.today);
  const [amount, setAmount] = useState(full ? String(full) : "");
  const [lines, setLines] = useState<LinesEdit | null>(null);
  const [fault, setFault] = useState<(typeof FAULTS)[number]>("partner");
  const [keep, setKeep] = useState<"keep" | "split">("keep");
  const [due2, setDue2] = useState(m.due_date);
  const [ev, setEv] = useState<EvidenceDraft>(EMPTY_EVIDENCE);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const late = post || !at ? 0 : daysBetween(m.due_date, at);
  const amountNum = money ? parseMoney(amount) : null;
  const short = money && amountNum !== null && amountNum < full;
  const issue = evidenceIssue(ev, RULE);
  const bad = post
    ? !at || at <= m.due_date
    : !at || (money && amountNum === null) || lines?.bad === true;
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.u5.fulfill.${k}`, o);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 U5 — luật hiển thị gom một chỗ, tách sau khi UI đóng băng
  async function go() {
    setTried(true);
    if (issue || bad) return;
    setBusy(true);
    setErr(null);
    const evidence = evidenceBody(ev, RULE);
    try {
      if (post) {
        const r = await requestChange(m.id, {
          kind: "postpone",
          payload: { to: at },
          evidence,
        });
        toast(L(r.state === "pending" ? "postponePending" : "postponed"));
      } else {
        const body: FulfillRequest = {
          at,
          evidence,
          ...(money && amountNum !== null ? { amount: amountNum } : {}),
          ...(lines && m.kind === "delivery"
            ? { qty_items: lines.items.map((x) => ({ contract_item_id: x.item_id, qty: x.qty })) }
            : {}),
          ...(late > 0 ? { fault } : {}),
          ...(short || lines?.items.some((x) => x.qty === 0)
            ? { remainder: keep === "split" ? { split: { due_date: due2 } } : ("keep" as const) }
            : {}),
        };
        await fulfillMilestone(m.id, body);
        toast(L("done"));
      }
      notifyFlowNavChanged(); // U4b-4 · số «Việc của tôi» giảm ngay sau khi xác nhận mốc
      p.onDone();
    } catch (e) {
      const code = e instanceof ApiError ? (e.code as string) : undefined;
      const k = fulfillErrorKey(code);
      setErr(
        k
          ? t(k, { who: whoOf((e as ApiError).details, t("contracts.work.u4.someone")) })
          : saveErrorText(e, t), // lỗi giao/kho (STOCK_INSUFFICIENT…): câu máy chủ soạn sẵn + gợi ý
      );
    } finally {
      setBusy(false);
    }
  }
  const title = post
    ? L("postponeTitle", { title: m.title })
    : L(
        m.kind === "delivery"
          ? "titleDelivery"
          : m.kind === "pay"
            ? "titlePay"
            : money
              ? "titleCollect"
              : "titleOther",
        { title: m.title },
      );
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="fulfill-dialog"
        className="my-auto flex w-full max-w-xl flex-col gap-3 rounded-xl border border-rule bg-panel p-5 shadow-xl"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-caption text-dim">{L("lead", { date: m.due_date })}</p>
        <div className="flex flex-col gap-1 text-[13px]">
          <label htmlFor="fulfill-at">
            {post ? L("newDue") : L(m.kind === "delivery" ? "atDelivery" : "atMoney")}
          </label>
          <DateInput
            id="fulfill-at"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="field w-[170px] font-mono"
          />
        </div>
        {!post && m.kind === "delivery" && p.deal && (
          <DeliveryLines id={m.id} deal={p.deal} editable onEdit={setLines} />
        )}
        {!post && money && (
          <div className="flex flex-col gap-1 text-[13px]">
            <label htmlFor="fulfill-amount">{L("amount")}</label>
            <input
              id="fulfill-amount"
              className="field w-[200px] font-mono"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        )}
        {late > 0 && (
          <fieldset className="flex flex-col gap-1 text-[13px]" data-testid="fault-ask">
            <legend className="mb-1">{L("late", { n: late })}</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={L("faultAsk")}>
              {FAULTS.map((f) => (
                <PillRadio key={f} checked={fault === f} onClick={() => setFault(f)}>
                  {t(`contracts.cdetail.fault.${f}`, { partner: p.partner })}
                </PillRadio>
              ))}
            </div>
          </fieldset>
        )}
        {!post && (short || lines?.items.some((x) => x.qty === 0)) && (
          <fieldset className="flex flex-col gap-1 text-[13px]" data-testid="remainder-ask">
            <legend className="mb-1">{L("short")}</legend>
            <div className="flex flex-wrap items-center gap-1.5">
              <PillRadio checked={keep === "keep"} onClick={() => setKeep("keep")}>
                {L("keep")}
              </PillRadio>
              <PillRadio checked={keep === "split"} onClick={() => setKeep("split")}>
                {L("split")}
              </PillRadio>
              {keep === "split" && (
                <DateInput
                  value={due2}
                  onChange={(e) => setDue2(e.target.value)}
                  className="field w-[150px] font-mono"
                />
              )}
            </div>
          </fieldset>
        )}
        <div>
          <p className="mb-1 text-sm font-medium">{L("evidence")}</p>
          <EvidenceInput
            rule={RULE}
            value={ev}
            onChange={setEv}
            issue={tried ? issue : null}
            disabled={busy}
          />
        </div>
        {err && (
          <p role="alert" className="text-sm text-late" data-testid="fulfill-error">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-quiet btn-sm" onClick={p.onClose}>
            {t("contracts.common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="fulfill-ok"
            disabled={busy}
            onClick={() => void go()}
          >
            {post ? L("postponeOk") : L("ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
