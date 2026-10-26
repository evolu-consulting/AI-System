// CR-097 G2 · GD-FR-01…05: chi tiết giao dịch — nháp ⇒ form sửa/ghi sổ/xoá; đã ghi sổ ⇒ xem + mô tả + điều chỉnh (lý do) + huỷ (lý do);
// dòng thời gian `events`, nghĩa vụ thanh toán (chỉ xem), link HĐ liên kết. Kết quả ghi sổ/điều chỉnh/huỷ hiện bảng kho trước → sau.
import type { TransactionActionOut, TransactionDetail } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { PageHead } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { Tag } from "~/components/shared/tag";
import { toast } from "~/components/shared/toast";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { adjustTx, cancelTx, describeTx, fetchTx, txKey } from "../api";
import { DraftEditor } from "../components/DraftEditor";
import { AdjustDialog, CancelDialog, StockResultDialog } from "../components/TxDialogs";
import { DescribeBlock, EventsBlock, LinesTable, ObligationsBlock } from "../components/TxPanels";
import { useTxRefs } from "../hooks/use-tx-refs";
import { useTxRun } from "../hooks/use-tx-run";
import { actionsOf, STATUS_TONE, stockRows } from "../lib/transactions";

type Shown = {
  title: string;
  out: Pick<TransactionActionOut, "stock" | "stock_reversed">;
  labels: ReadonlyMap<string, string>;
};

export function TransactionDetailPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const { write } = useMe();
  const refs = useTxRefs();
  const q = useQuery({ queryKey: txKey(id), queryFn: ({ signal }) => fetchTx(id, signal) });
  const [shown, setShown] = useState<Shown | null>(null);
  const [dialog, setDialog] = useState<"adjust" | "cancel" | null>(null);
  const act = useTxRun();
  const desc = useTxRun();
  const tx = q.data;
  if (q.isLoading) return <Loading />;
  if (q.error || !tx)
    return <ErrorLine error={q.error ?? new Error(t("contracts.txn.errors.notFound"))} />;

  const can = actionsOf(tx.status, write);
  const show = (
    title: string,
    out: TransactionActionOut,
    labels: ReadonlyMap<string, string> = refs.labels,
  ) => setShown({ title, out, labels });
  const adjust = async (body: Parameters<typeof adjustTx>[1]) => {
    const r = await act.run(() => adjustTx(id, body));
    if (r) {
      setDialog(null);
      show(t("contracts.txn.adjust.done"), r);
    }
  };
  const cancel = async (reason: string) => {
    const r = await act.run(() => cancelTx(id, reason));
    if (r) {
      setDialog(null);
      show(t("contracts.txn.cancel.done"), r);
    }
  };
  const describe = async (v: { note: string; holder: string; lot_label: string }) => {
    const r = await desc.run(() =>
      describeTx(id, {
        note: v.note.trim() || null,
        holder: v.holder.trim() || null,
        lot_label: v.lot_label.trim() || null,
      }),
    );
    if (r) toast(t("contracts.txn.describe.saved"));
  };
  return (
    <div className="text-base leading-[1.55]" data-testid="tx-detail">
      <Head tx={tx} />
      {tx.status === "draft" ? (
        <DraftEditor
          tx={tx}
          write={write}
          onPosted={(r, l) => show(t("contracts.txn.post.done"), r, l)}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {(can.adjust || can.cancel) && (
            <div className="flex gap-2">
              {can.adjust && (
                <button
                  type="button"
                  className="btn"
                  data-testid="tx-adjust"
                  onClick={() => {
                    act.setError(null);
                    setDialog("adjust");
                  }}
                >
                  {t("contracts.txn.adjust.button")}
                </button>
              )}
              {can.cancel && (
                <button
                  type="button"
                  className="btn text-late"
                  data-testid="tx-cancel"
                  onClick={() => {
                    act.setError(null);
                    setDialog("cancel");
                  }}
                >
                  {t("contracts.txn.cancel.button")}
                </button>
              )}
            </div>
          )}
          <LinesTable tx={tx} />
          <ObligationsBlock tx={tx} />
          <DescribeBlock
            key={tx.updated_at}
            tx={tx}
            canEdit={can.describe}
            busy={desc.busy}
            error={desc.error}
            onSave={(v) => void describe(v)}
          />
        </div>
      )}
      <div className="mt-3">
        <EventsBlock tx={tx} />
      </div>
      {dialog === "adjust" && (
        <AdjustDialog
          tx={tx}
          products={refs.products}
          busy={act.busy}
          error={act.error}
          onSubmit={(b) => void adjust(b)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "cancel" && (
        <CancelDialog
          busy={act.busy}
          error={act.error}
          onSubmit={(r) => void cancel(r)}
          onClose={() => setDialog(null)}
        />
      )}
      {shown && (
        <StockResultDialog
          title={shown.title}
          rows={stockRows(shown.out.stock, shown.labels)}
          reversed={shown.out.stock_reversed}
          onClose={() => setShown(null)}
        />
      )}
    </div>
  );
}

function Head({ tx }: { tx: TransactionDetail }) {
  const { t } = useTranslation();
  return (
    <PageHead
      crumb={
        <Link to="/transactions" className="hover:underline">
          {t("contracts.txn.title")}
        </Link>
      }
      title={`${t(`contracts.txn.deal.${tx.deal}`)} · ${tx.partner_name}`}
      lead={
        <span className="flex flex-wrap items-center gap-2">
          <Tag tone={STATUS_TONE[tx.status]}>{t(`contracts.txn.status.${tx.status}`)}</Tag>
          <span>{viDate(tx.occurred_on)}</span>
          {tx.rev > 1 && <span>{t("contracts.txn.rev", { n: tx.rev })}</span>}
          {tx.contract_id && (
            <Link
              to="/contracts/$id"
              params={{ id: tx.contract_id }}
              className="text-act hover:underline"
              data-testid="tx-contract-link"
            >
              {t("contracts.txn.openContract")}
            </Link>
          )}
          {tx.cancel_reason && (
            <span className="text-late">
              {t("contracts.txn.cancelReason", { reason: tx.cancel_reason })}
            </span>
          )}
        </span>
      }
    />
  );
}
