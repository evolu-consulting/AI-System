// U3 · R45 · một vai của "Cách tính điểm": bật/tắt + trọng số (tổng 100), mức TỐT/KHÁ, số việc tối thiểu, khoảng tính, hệ số gần đây,
// chỉnh tay ±10; "xem trước" N đối tác đổi mức; Lưu tăng phiên bản + ghi lịch sử (R46). Chỉ quản lý (`owner`) sửa.
import type { PartnerRole, ScoreConfigOut, ScoringDraft } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { scoringIssue, weightSum } from "~/features/partners/lib/partner-score";
import { useSaveScoring, useScoring } from "../hooks/use-scoring";
import { same } from "../lib/data";
import { Num, Panel, Row, Switch } from "./controls";
import { ScoringHistory } from "./ScoringHistory";
import { ScoringImpact } from "./ScoringImpact";

const draftOf = (c: ScoreConfigOut): ScoringDraft => ({
  criteria: c.criteria.map(({ key, kind, label, enabled, weight }) => ({
    key,
    kind,
    label,
    enabled,
    weight,
  })),
  rules: { ...c.rules },
});

function Body({ role, cfg, owner }: { role: PartnerRole; cfg: ScoreConfigOut; owner: boolean }) {
  const { t } = useTranslation();
  const s = (k: string, o?: Record<string, unknown>) => t(`contracts.settings.score.${k}`, o);
  const save = useSaveScoring(role);
  const base = draftOf(cfg);
  const [draft, setDraft] = useState<ScoringDraft>(base);
  // Bản lưu đổi (mở lần đầu, sau khi Lưu, đổi vai) ⇒ nháp = bản mới.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ theo version
  useEffect(() => setDraft(draftOf(cfg)), [cfg.version, role]);
  const { criteria, rules } = draft;
  const dirty = !same(draft, base);
  const manualOn = criteria.some((c) => c.kind === "manual" && c.enabled);
  const issue = manualOn ? "manual" : scoringIssue(criteria, rules);
  const sum = weightSum(criteria);
  const setRule = <K extends keyof ScoringDraft["rules"]>(k: K, v: ScoringDraft["rules"][K]) =>
    setDraft({ ...draft, rules: { ...rules, [k]: v } });
  const setCrit = (i: number, p: Partial<ScoringDraft["criteria"][number]>) =>
    setDraft({ ...draft, criteria: criteria.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const doSave = () =>
    save.mutate(draft, {
      onSuccess: () => toast(s("saved")),
      onError: (e) =>
        toast(e instanceof ApiError && e.status === 422 ? e.message : s("saveFail"), "late"),
    });
  return (
    <div data-testid={`scoring-${role}`}>
      <p className="mb-3 text-caption text-dim">
        {s("version", { n: cfg.version })}
        {cfg.updated_at ? ` · ${cfg.updated_at.slice(0, 10).split("-").reverse().join("/")}` : ""}
      </p>
      <Panel title={s("critTitle")} sub={s("critSub")}>
        {criteria.map((c, i) => (
          <Row key={c.key} label={c.label}>
            <span className="flex items-center gap-3">
              <Switch
                checked={c.enabled}
                label={s("use", { name: c.label })}
                onChange={(v) => setCrit(i, { enabled: v })}
              />
              <Num
                label={s("weight", { name: c.label })}
                value={c.weight}
                min={0}
                max={100}
                suffix="%"
                className="w-28"
                onChange={(v) => setCrit(i, { weight: v })}
              />
              {c.kind === "manual" && (
                <span className="text-caption text-late">{s("manualClosed")}</span>
              )}
            </span>
          </Row>
        ))}
        <p
          className={`border-t border-rule-soft px-5 py-3 text-label ${sum === 100 ? "text-ok" : "text-late"}`}
          data-testid="score-sum"
        >
          {s("sum", { n: sum })}
        </p>
      </Panel>
      <Panel title={s("rulesTitle")}>
        <Row label={s("goodFrom")} htmlFor="sc-good">
          <Num
            id="sc-good"
            value={rules.good_from}
            min={1}
            max={100}
            className="w-28"
            onChange={(v) => setRule("good_from", v)}
          />
        </Row>
        <Row label={s("fairFrom")} htmlFor="sc-fair">
          <Num
            id="sc-fair"
            value={rules.fair_from}
            min={1}
            max={100}
            className="w-28"
            onChange={(v) => setRule("fair_from", v)}
          />
        </Row>
        <Row label={s("minEvents")} htmlFor="sc-min">
          <Num
            id="sc-min"
            value={rules.min_events}
            min={0}
            max={100}
            className="w-28"
            onChange={(v) => setRule("min_events", v)}
          />
        </Row>
        <Row label={s("windowMonths")} htmlFor="sc-win">
          <Num
            id="sc-win"
            value={rules.window_months}
            min={1}
            max={60}
            suffix={s("months")}
            className="w-36"
            onChange={(v) => setRule("window_months", v)}
          />
        </Row>
        <Row label={s("recency")} htmlFor="sc-rec">
          <span className="flex items-center gap-3">
            <Switch
              checked={rules.recency_boost}
              label={s("recency")}
              onChange={(v) => setRule("recency_boost", v)}
            />
            <Num
              id="sc-rec"
              value={rules.recency_months}
              min={1}
              max={60}
              suffix={s("months")}
              className="w-36"
              onChange={(v) => setRule("recency_months", v)}
            />
          </span>
        </Row>
        <Row label={s("manualAdjust")}>
          <Switch
            checked={rules.manual_adjust}
            label={s("manualAdjust")}
            onChange={(v) => setRule("manual_adjust", v)}
          />
        </Row>
      </Panel>
      {issue && (
        <p role="alert" className="mb-3 text-caption text-late">
          {s(`err.${issue}`)}
        </p>
      )}
      <ScoringImpact role={role} draft={dirty && !issue ? draft : null} />
      {owner && (
        <div className="mb-4 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={!dirty || save.isPending}
            onClick={() => setDraft(base)}
          >
            {s("discard")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="scoring-save"
            disabled={!dirty || issue !== null || save.isPending}
            onClick={doSave}
          >
            {s("save")}
          </button>
        </div>
      )}
      <ScoringHistory role={role} />
    </div>
  );
}

export function ScoringEditor({ role, owner }: { role: PartnerRole; owner: boolean }) {
  const { t } = useTranslation();
  const q = useScoring(role);
  if (q.isLoading) return <p className="text-dim">{t("contracts.common.loading")}</p>;
  if (q.error || !q.data)
    return (
      <p role="alert" className="text-late">
        {t("contracts.settings.loadFail")}
      </p>
    );
  return (
    <fieldset disabled={!owner || undefined} className="min-w-0 border-0 p-0">
      <Body role={role} cfg={q.data} owner={owner} />
    </fieldset>
  );
}
