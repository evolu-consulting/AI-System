// V2-L · CD-05: "Mức & đánh giá" — ngưỡng TỐT/KHÁ, số việc tối thiểu, đánh giá thủ công (tỷ trọng, lệch bao nhiêu thì bắt ghi lý do),
// chốt điểm hằng tháng (chỉ tháng); kèm "thử tính". "Nhắc đánh giá khi" chưa lưu (V2-K).
import type { RepSettingsIn } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { levelOf, needsReason } from "../lib/try-calc";
import { Num, Panel, Row, Switch } from "./controls";
import { TryBox, TryNum } from "./TryBox";

export function CommonPane({
  value: v,
  set,
}: {
  value: RepSettingsIn;
  set: (v: RepSettingsIn) => void;
}) {
  const { t } = useTranslation();
  const s = (k: string, o?: Record<string, string | number>) =>
    t(`contracts.settings.common.${k}`, o);
  const [md, setMd] = useState(78);
  const [ms, setMs] = useState(4.5);
  const on = v.manual_share > 0;
  const st = Math.min(5, Math.max(0, ms)) * 20;
  const use = on && ms > 0;
  const fin = Math.round(
    use ? ((100 - v.manual_share) / 100) * md + (v.manual_share / 100) * st : md,
  );
  return (
    <>
      <Panel title={s("levels")}>
        <Row label={s("good")} htmlFor="th-good">
          <Num
            id="th-good"
            value={v.good_from}
            min={1}
            max={100}
            className="max-w-48"
            onChange={(x) => set({ ...v, good_from: x })}
          />
        </Row>
        <Row label={s("fair")} htmlFor="th-fair">
          <Num
            id="th-fair"
            value={v.fair_from}
            min={0}
            max={99}
            className="max-w-48"
            onChange={(x) => set({ ...v, fair_from: x })}
          />
        </Row>
        {v.fair_from >= v.good_from && (
          <p role="alert" className="px-5 pb-3 text-caption text-late">
            {s("order")}
          </p>
        )}
        <Row label={s("minJobs")} htmlFor="min-jobs">
          <Num
            id="min-jobs"
            value={v.min_jobs}
            min={0}
            max={100}
            suffix={s("jobs")}
            className="max-w-48"
            onChange={(x) => set({ ...v, min_jobs: x })}
          />
        </Row>
      </Panel>
      <Panel
        title={s("manual")}
        action={
          <Switch
            checked={on}
            label={s("manual")}
            onChange={(x) => set({ ...v, manual_share: x ? 20 : 0 })}
          />
        }
      >
        <div className={on ? "" : "pointer-events-none opacity-50"}>
          <Row label={s("share")} htmlFor="man-share">
            <div className="flex items-center gap-3">
              <input
                id="man-share"
                type="range"
                min={0}
                max={50}
                step={5}
                value={v.manual_share}
                className="flex-1 accent-[var(--primary)]"
                onChange={(e) => set({ ...v, manual_share: Number(e.target.value) })}
              />
              <span className="w-10 text-right tabular-nums">{v.manual_share}%</span>
            </div>
          </Row>
          <Row label={s("gap")} htmlFor="man-gap">
            <Num
              id="man-gap"
              value={v.reason_gap}
              min={0}
              max={100}
              suffix={s("points")}
              className="max-w-48"
              onChange={(x) => set({ ...v, reason_gap: x })}
            />
          </Row>
        </div>
      </Panel>
      <Panel title={s("lock")}>
        <Row label={s("lockLabel")}>
          <span className="text-label">{s("monthly")}</span>
          <p className="text-caption text-dim">{s("lockHint")}</p>
        </Row>
      </Panel>
      <TryBox
        formula={[
          s("f1"),
          on ? s("f2", { a: 100 - v.manual_share, b: v.manual_share }) : s("f2off"),
          s("f3", { gap: v.reason_gap }),
          s("f4", { good: v.good_from, fair: v.fair_from }),
        ]}
      >
        <div className="grid gap-2 text-caption">
          <div className="flex items-center justify-between">
            <span>{s("tData")}</span>
            <TryNum label={s("tData")} value={md} min={0} max={100} onChange={setMd} />
          </div>
          <div className="flex items-center justify-between">
            <span>{s("tStars")}</span>
            <TryNum label={s("tStars")} value={ms} min={0} max={5} step={0.5} onChange={setMs} />
          </div>
          {use && needsReason(md, ms, v.reason_gap) && (
            <p className="text-soon">{s("needReason", { gap: v.reason_gap })}</p>
          )}
          <div className="flex items-center justify-between border-t border-rule-soft pt-2 text-label">
            <span>{s("tResult")}</span>
            <b data-testid="try-result" className="text-lg tabular-nums">
              {fin} · {t(`contracts.settings.rep.level.${levelOf(fin, v.good_from, v.fair_from)}`)}
            </b>
          </div>
        </div>
      </TryBox>
    </>
  );
}
