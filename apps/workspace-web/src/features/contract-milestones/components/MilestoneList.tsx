// CR-127 · U5 · BR-41…56 · M9: "Các mốc thực hiện" giữa trang chi tiết — mỗi mốc: ai làm, điều khoản gốc, hạn/trễ, Chưa ai nhận / X đang xử lý,
// Xác nhận · Dời hạn ngay trên mốc; mốc trễ có phạt ước tính + Ghi vào công nợ / Không tính phạt. Thay cho "Dòng thời gian" cũ.
import type { ContractDetail, Milestone, PenaltyView } from "@ai/contracts/pack-contracts";
import { ApiError } from "@ai/web-kit/http";
import { toast } from "@ai/web-kit/ui/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { Tag } from "~/components/shared/tag";
import { useMemberNames } from "~/features/contract-review/hooks/use-manage";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { claimTask, cr127ErrorKey, releaseTask, whoOf } from "~/platform/flow";
import {
  decidePenalty,
  listObligations,
  listPenalties,
  obligationsKey,
  penaltiesKey,
} from "../api-exec";
import { isMoney, type RowView, rowView } from "../lib/milestone-rows";
import { FulfillDialog } from "./FulfillDialog";

const DOT: Record<string, string> = {
  done: "bg-ok",
  late: "bg-soon",
  cur: "bg-act",
  over: "bg-late",
  up: "bg-line",
  cancelled: "bg-line",
};

/** Điều khoản gốc của mốc AI lập (Điều x · trang y) — từ `ai.milestones` khớp (loại + hạn). */
function clauseOf(c: ContractDetail, m: Milestone): string | null {
  const a = c.ai?.milestones.find((x) => x.kind === m.kind && x.due_date === m.due_date);
  if (!a?.clause_ref) return null;
  return a.page ? `${a.clause_ref} · tr.${a.page}` : a.clause_ref;
}

function PenaltyBox({ p, onChanged }: { p: PenaltyView; onChanged: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.u5.penalty.${k}`, o);
  if (p.decision) {
    return (
      <p className="mt-1 text-caption text-dim" data-testid="penalty-decided">
        {L(p.decision === "booked" ? "booked" : "waived")}
      </p>
    );
  }
  if (!p.estimate) {
    return p.reason === "no_term" || p.reason === "missing_amount" ? (
      <p className="mt-1 text-caption text-dim">{L(`reason.${p.reason}`)}</p>
    ) : null;
  }
  const est = p.estimate;
  const run = async (decision: "book" | "waive") => {
    setBusy(true);
    try {
      await decidePenalty(
        p.obligation_id,
        decision === "book"
          ? { decision, amount: est.amount }
          : { decision, evidence: { note: L("waiveNote") } },
      );
      onChanged();
    } catch (e) {
      const code = e instanceof ApiError ? (e.code as string) : "";
      toast(t(`contracts.u5.err.${code}`, { defaultValue: t("contracts.errors.unknown") }), "late");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="mt-2 rounded-lg border border-soon-line bg-soon-bg px-3 py-2 text-[13px]"
      data-testid="penalty-box"
    >
      <p>
        {L(p.direction === "pay" ? "estimatePay" : "estimateReceive", {
          amount: vnd(est.amount),
          days: p.days_late,
        })}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-testid="penalty-book"
          disabled={busy}
          onClick={() => void run("book")}
        >
          {L("book")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          data-testid="penalty-waive"
          disabled={busy}
          onClick={() => void run("waive")}
        >
          {L("waive")}
        </button>
      </div>
    </div>
  );
}

function ClaimLine({
  v,
  name,
  onChanged,
}: {
  v: RowView;
  name: (id: string | null) => string | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const run = async (f: (id: string) => Promise<unknown>, id: string) => {
    setBusy(true);
    try {
      await f(id);
    } catch (e) {
      const k = e instanceof ApiError ? cr127ErrorKey(e.code as string) : null;
      toast(
        k
          ? t(k, { who: whoOf((e as ApiError).details, t("contracts.work.u4.someone")) })
          : t("contracts.errors.unknown"),
        "late",
      );
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const c = v.claim;
  if (c.kind === "unclaimed")
    return (
      <span
        className="flex items-center gap-2 text-caption"
        data-testid="claim-line"
        data-claim="unclaimed"
      >
        <span className="text-dim">{t("contracts.work.u4.claim.unclaimed")}</span>
        {v.canClaim && (
          <button
            type="button"
            className="btn btn-sm"
            data-testid="ms-claim"
            disabled={busy}
            onClick={() => void run(claimTask, c.taskId)}
          >
            {t("contracts.work.u4.claim.take")}
          </button>
        )}
      </span>
    );
  if (c.kind === "other")
    return (
      <span className="text-caption text-dim" data-testid="claim-line" data-claim="other">
        {t("contracts.work.u4.claim.other", { who: name(c.by) ?? t("contracts.work.u4.someone") })}
      </span>
    );
  if (c.kind === "mine")
    return (
      <span
        className="flex items-center gap-2 text-caption"
        data-testid="claim-line"
        data-claim="mine"
      >
        <span className="text-dim">{t("contracts.u5.ms.mine")}</span>
        {v.canRelease && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            data-testid="ms-release"
            disabled={busy}
            onClick={() => void run(releaseTask, c.taskId)}
          >
            {t("contracts.work.u4.claim.release")}
          </button>
        )}
      </span>
    );
  return null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 U5 — luật hiển thị gom một chỗ, tách sau khi UI đóng băng
function Row(p: {
  v: RowView;
  c: ContractDetail;
  partner: string;
  pen: PenaltyView | undefined;
  name: (id: string | null) => string | null;
  onAct: (m: Milestone, mode: "fulfill" | "postpone") => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { v, c } = p;
  const m = v.m;
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.u5.ms.${k}`, o);
  const clause = clauseOf(c, m);
  const who = m.owner === "ours" ? L("ours") : p.partner;
  const amt = m.amount_effective ?? m.amount;
  const meta = v.meta
    ? t(`contracts.cdetail.${v.meta.key}`, { date: viDate(m.due_date), n: v.meta.n })
    : null;
  return (
    <li
      className="grid grid-cols-[18px_1fr_auto] items-start gap-3 border-t border-rule px-4 py-3 first:border-t-0"
      data-testid="ms-row"
      data-state={v.state}
      data-kind={m.kind}
    >
      <span
        className={`mt-1.5 h-3 w-3 rounded-full ${DOT[v.state] ?? "bg-line"}`}
        aria-hidden="true"
      />
      <div className="min-w-0 text-[13.5px]">
        <p className="flex flex-wrap items-center gap-2">
          <b>{m.title}</b>
          {isMoney(m.kind) && amt != null && <span className="text-dim">· {vnd(amt)}</span>}
          {m.qty != null && m.kind === "delivery" && (
            <span className="text-dim">· {t("contracts.cdetail.qtyOf", { n: m.qty })}</span>
          )}
          <Tag tone="grey">{who}</Tag>
          {clause && <span className="text-caption text-act">{clause}</span>}
        </p>
        <p className="mt-0.5 text-caption text-dim">
          {meta}
          {v.why === "hold" && ` · ${L("whyHold")}`}
        </p>
        {m.status === "open" && <ClaimLine v={v} name={p.name} onChanged={p.onChanged} />}
        {v.why === "unclaimed" && <p className="text-caption text-dim">{L("whyUnclaimed")}</p>}
        {p.pen && <PenaltyBox p={p.pen} onChanged={p.onChanged} />}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 whitespace-nowrap">
        {m.status === "done" && <Tag tone="ok">{L("done")}</Tag>}
        {m.status === "open" && !v.canConfirm && !v.canPostpone && (
          <Tag tone="grey">{L("upcoming")}</Tag>
        )}
        {v.canPostpone && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            data-testid="ms-postpone"
            onClick={() => p.onAct(m, "postpone")}
          >
            {L("postpone")}
          </button>
        )}
        {v.canConfirm && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="ms-confirm"
            onClick={() => p.onAct(m, "fulfill")}
          >
            {L(
              m.kind === "delivery"
                ? "confirmDelivery"
                : m.kind === "pay"
                  ? "confirmPay"
                  : isMoney(m.kind)
                    ? "confirmCollect"
                    : "confirm",
            )}
          </button>
        )}
      </div>
    </li>
  );
}

export function MilestoneList(p: {
  c: ContractDetail;
  partner: string;
  write: boolean;
  today: string;
  superseded: boolean;
}) {
  const { t } = useTranslation();
  const { c } = p;
  const qc = useQueryClient();
  const me = useMe();
  const name = useMemberNames();
  const [act, setAct] = useState<{ m: Milestone; mode: "fulfill" | "postpone" } | null>(null);
  const obs = useQuery({
    queryKey: obligationsKey(c.id),
    queryFn: ({ signal }) => listObligations(c.id, signal),
    staleTime: 15_000,
  });
  const pens = useQuery({
    queryKey: penaltiesKey(c.id),
    queryFn: ({ signal }) => listPenalties(c.id, signal),
    staleTime: 15_000,
    enabled: c.status === "done",
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["contract", c.id] });
    void qc.invalidateQueries({ queryKey: ["contracts", "list"] });
  };
  const ms = c.milestones
    .filter((m) => m.status !== "cancelled")
    .slice()
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.seq - b.seq);
  if (ms.length === 0) return null;
  const byId = new Map((obs.data ?? []).map((o) => [o.id, o]));
  const penById = new Map((pens.data?.items ?? []).map((x) => [x.obligation_id, x]));
  const opts = {
    today: p.today,
    nextId: c.next_milestone_id,
    write: p.write,
    held: c.hold !== null,
    superseded: p.superseded,
    userId: me.user?.id,
    admin: me.owner,
  };
  return (
    <Panel className="mb-4">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <h2 className="text-[15px] font-semibold" data-testid="ms-title">
          {t("contracts.u5.ms.title")}{" "}
          <span className="text-caption font-normal text-dim">· {t("contracts.u5.ms.sub")}</span>
        </h2>
      </div>
      <ul data-testid="ms-list">
        {ms.map((m) => (
          <Row
            key={m.id}
            v={rowView(m, byId.get(m.id), opts)}
            c={c}
            partner={p.partner}
            pen={penById.get(m.id)}
            name={name}
            onAct={(mm, mode) => setAct({ m: mm, mode })}
            onChanged={() => {
              void obs.refetch();
              void pens.refetch();
              refresh();
            }}
          />
        ))}
      </ul>
      {act && (
        <FulfillDialog
          m={act.m}
          mode={act.mode}
          today={p.today}
          deal={c.deal}
          partner={p.partner}
          onClose={() => setAct(null)}
          onDone={() => {
            setAct(null);
            void obs.refetch();
            void pens.refetch();
            refresh();
          }}
        />
      )}
    </Panel>
  );
}
