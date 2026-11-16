// CR-152 · bản mẫu nq-chitiet / ht-chitiet: hộp «Ghi doanh thu kỳ» (Nhượng quyền) / «Ghi đối soát kỳ» (Hợp tác có chia) — chọn kỳ, nhập số,
// thấy số tiền tính ra TRƯỚC khi lưu, rồi `PUT /periods/:key`. Chỉ kỳ còn mốc mở (kỳ đã xác nhận thu/trả thì máy chủ trả 409).

import type { KindTermsView, Period } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Input } from "@ai/web-kit/ui/kit/input";
import { toast } from "@ai/web-kit/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { parseMoney, vnd } from "~/components/shared/format";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { coopShares, franchiseFee } from "~/features/contract-form/lib/kind-terms";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import { contractKey, kindTermsKey, putPeriod } from "../api";
import { saveErrorText } from "../lib/save-error";

/** Kỳ còn ghi được: có mốc báo cáo / đối soát chưa xong và mốc thu/trả phí của kỳ chưa xác nhận. */
export const openPeriods = (v: KindTermsView): Period[] =>
  v.periods.filter(
    (p) =>
      p.report !== null &&
      p.report.status === "open" &&
      p.fee?.status !== "done" &&
      p.fee?.status !== "cancelled",
  );

type L = (k: string, o?: Record<string, unknown>) => string;

function Preview({ view, figure, L }: { view: KindTermsView; figure: number; L: L }) {
  const calc =
    view.deal === "franchise" ? franchiseFee(view.terms, figure) : coopShares(view.terms, figure);
  if (calc === null) return null;
  return (
    <p role="status" data-testid="period-preview" className="rounded-lg bg-act-soft px-3 py-2">
      {typeof calc === "number"
        ? L("previewFranchise", { fee: vnd(calc) })
        : L("previewCoop", { our: vnd(calc.our), partner: vnd(calc.partner) })}
    </p>
  );
}

/** Lưu kỳ: gọi API, làm mới tóm tắt + chi tiết (số tiền mốc đổi), báo lỗi bằng câu nghiệp vụ. */
function useSavePeriod(id: string, franchise: boolean, L: L, onClose: () => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(key: string, figure: number) {
    setBusy(true);
    setErr(null);
    try {
      await putPeriod(id, key, figure);
      await qc.invalidateQueries({ queryKey: kindTermsKey(id) });
      await qc.invalidateQueries({ queryKey: contractKey(id) });
      toast(L(franchise ? "savedFranchise" : "savedCoop"));
      onClose();
    } catch (e) {
      setErr(saveErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }
  return { busy, err, save };
}

export function PeriodDialog({
  id,
  view,
  onClose,
}: {
  id: string;
  view: KindTermsView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const L: L = (k, o) => t(`contracts.kinds.period.${k}`, o);
  const list = openPeriods(view);
  const [key, setKey] = useState((list.find((p) => p.figure === null) ?? list[0])?.key ?? "");
  const [raw, setRaw] = useState("");
  const franchise = view.deal === "franchise";
  const { busy, err, save } = useSavePeriod(id, franchise, L, onClose);
  const cur = list.find((p) => p.key === key);
  const figure = parseMoney(raw);
  const badNum = figure !== null && Number.isNaN(figure);
  const ok = figure !== null && !badNum && !!cur;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{L(franchise ? "titleFranchise" : "titleCoop")}</DialogTitle>
          <DialogDescription>{L(franchise ? "hintFranchise" : "hintCoop")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3 text-[13px]">
            <label className="flex flex-col gap-1" htmlFor="pd-period">
              {L("period")}
              <OptionSelect id="pd-period" value={key} onValueChange={(v) => setKey(v)}>
                {list.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </OptionSelect>
            </label>
            <label className="flex flex-col gap-1" htmlFor="pd-figure">
              {L(cur?.figure_kind === "profit" ? "figureProfit" : "figureRevenue")}
              <Input
                id="pd-figure"
                inputMode="numeric"
                className="font-mono"
                value={raw}
                placeholder={cur?.figure != null ? vnd(cur.figure) : ""}
                onChange={(e) => setRaw(e.target.value)}
              />
            </label>
            {badNum && (
              <p role="alert" className="text-late">
                {L("bad")}
              </p>
            )}
            {ok && <Preview view={view} figure={figure} L={L} />}
            {err && (
              <p role="alert" className="text-late">
                {err}
              </p>
            )}
          </div>
        </DialogBody>
        <DialogFooter className="gap-2">
          <Button variant="quiet" size="sm" onClick={onClose}>
            {L("later")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!ok || busy}
            onClick={() => cur && ok && void save(cur.key, figure)}
          >
            {L(franchise ? "saveFranchise" : "saveCoop")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
