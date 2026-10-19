// HD8-FR-03 · S-p06 `/settings/scoring` — port `mgmt-app/web/src/pages/settings/ScoringPage.tsx`: tab Khách hàng / Nhà cung cấp,
// bản nháp tiêu chí + quy tắc, xem trước (trễ 400 ms, chỉ khi tổng = 100 và đã đổi), "Lưu & tính lại điểm" (chỉ quản lý), lịch sử.
import type { PartnerRole, ScorePreview } from "@ai/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { toast } from "~/components/shared/toast";
import { useMe } from "~/features/pack-state/hooks/use-me";
import {
  fetchScoring,
  fetchScoringHistory,
  partnerKeys,
  previewScoring,
  saveScoring,
} from "~/features/partners/api";
import { CriteriaPanel } from "../components/CriteriaPanel";
import { HistoryPanel, PreviewPanel, RulesPanel, WhenPanel } from "../components/RulesPanels";
import { scoringErrorText } from "../lib/errors";
import { type Draft, isDirty, totalOf } from "../lib/scoring";

const PREVIEW_DEBOUNCE_MS = 400;

function usePreview(role: PartnerRole, d: Draft | null, on: boolean) {
  const [p, setP] = useState<ScorePreview | null>(null);
  useEffect(() => {
    if (!d || !on) {
      setP(null);
      return;
    }
    // Trễ 400 ms như mgmt: gõ liên tục không gửi mỗi phím (không phải chờ trạng thái).
    const h = setTimeout(
      () => previewScoring(role, d).then(setP, () => setP(null)),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(h);
  }, [d, on, role]);
  return p;
}

export function ScoringPage() {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.scoring.${k}`);
  const [role, setRole] = useState<PartnerRole>("customer");
  const { owner } = useMe();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: partnerKeys.scoring(role),
    queryFn: ({ signal }) => fetchScoring(role, signal),
  });
  const hist = useQuery({
    queryKey: partnerKeys.history(role),
    queryFn: ({ signal }) => fetchScoringHistory(role, signal),
  });
  const [d, setD] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setD({ criteria: q.data.criteria, rules: q.data.rules });
  }, [q.data]);
  const total = totalOf(d);
  const dirty = isDirty(d, q.data);
  const preview = usePreview(role, d, dirty && total === 100);
  if (q.isLoading || !d) return q.error ? <ErrorLine error={q.error} /> : <Loading />;
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await saveScoring(role, d);
      await qc.invalidateQueries();
      toast(L("saved"));
    } catch (e) {
      setErr(scoringErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="text-base leading-[1.55]">
      <PageHead
        crumb={
          <Link to="/partners" className="hover:underline">
            {L("back")}
          </Link>
        }
        title={L("title")}
        lead={L("lead")}
        actions={
          owner && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty || total !== 100 || busy}
              onClick={() => void save()}
            >
              {busy ? L("saving") : L("save")}
            </button>
          )
        }
      />
      <div role="tablist" className="mb-4 inline-flex rounded-lg bg-idle-bg p-1">
        {(["customer", "supplier"] as const).map((r) => (
          <button
            key={r}
            role="tab"
            type="button"
            aria-selected={role === r}
            onClick={() => setRole(r)}
            className={`h-9 rounded-md px-4 text-sm ${role === r ? "bg-panel font-semibold shadow-sm" : "text-dim"}`}
          >
            {r === "customer" ? L("tabCustomer") : L("tabSupplier")}
          </button>
        ))}
      </div>
      {err && (
        <p role="alert" className="mb-3 text-sm text-late">
          {err}
        </p>
      )}
      <CriteriaPanel d={d} setD={setD} cfg={q.data} owner={owner} />
      <WhenPanel />
      <RulesPanel d={d} setD={setD} owner={owner} />
      {preview && <PreviewPanel p={preview} />}
      <HistoryPanel rows={hist.data} />
    </div>
  );
}
