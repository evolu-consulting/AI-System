// V2-L · CD-02/03: tab "Thời gian" — khoảng tính điểm, việc cũ tính nhẹ dần (bậc thang theo tháng · không giảm), điểm trừ mỗi ngày trễ,
// kèm "thử tính" hệ số độ cũ của 3 việc mẫu.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { criterionFromJobs, decayAt } from "../lib/try-calc";
import type { Cell } from "../lib/types";
import { Num, Panel, Row, Seg } from "./controls";
import { TryBox, TryNum } from "./TryBox";

const DEFAULT_STEP = { months: [6, 12], factors: [1, 0.5, 0.2] };
const WINDOWS = [6, 12, 24, 36] as const;

export function TimeTab({ cell, set }: { cell: Cell; set: (c: Cell) => void }) {
  const { t } = useTranslation();
  const s = (k: string, o?: Record<string, string | number>) =>
    t(`contracts.settings.time.${k}`, o);
  const [jobs, setJobs] = useState([
    { id: "j1", age: 2, score: 100 },
    { id: "j2", age: 8, score: 60 },
    { id: "j3", age: 15, score: 40 },
  ]);
  const stepped = cell.decay.months.length > 0;
  const { months, factors } = cell.decay;
  const band = (i: number) =>
    i === 0
      ? s("under", { m: months[0] ?? 0 })
      : i < months.length
        ? s("between", { a: months[i - 1] ?? 0, b: months[i] ?? 0 })
        : s("over", { m: months[i - 1] ?? 0 });
  const setDecay = (d: Cell["decay"]) => set({ ...cell, decay: d });
  const h = jobs.map((j) => Math.round(decayAt(j.age, cell) * 100));
  const w = criterionFromJobs(jobs, cell);
  const plain = jobs.reduce((a, j) => a + j.score, 0) / jobs.length;
  return (
    <>
      <Panel>
        <Row label={s("window")}>
          <Seg
            label={s("window")}
            value={cell.window_months}
            onChange={(v) => set({ ...cell, window_months: v })}
            options={WINDOWS.map((m) => [m, s("months", { m })] as const)}
          />
        </Row>
        <Row label={s("decay")}>
          <Seg
            label={s("decay")}
            value={stepped ? "step" : "none"}
            onChange={(v) =>
              setDecay(v === "none" ? { months: [], factors: [1] } : structuredClone(DEFAULT_STEP))
            }
            options={[
              ["step", s("step")],
              ["none", s("none")],
            ]}
          />
        </Row>
        {stepped && (
          <Row label={s("ratio")}>
            <div className="grid gap-3 md:grid-cols-3">
              {factors.map((f, i) => (
                <div key={band(i)}>
                  <label className="mb-1 block text-caption text-dim" htmlFor={`dc-${i}`}>
                    {band(i)}
                  </label>
                  <Num
                    id={`dc-${i}`}
                    value={Math.round(f * 100)}
                    min={1}
                    max={100}
                    suffix="%"
                    onChange={(v) =>
                      setDecay({ months, factors: factors.map((x, j) => (j === i ? v / 100 : x)) })
                    }
                  />
                </div>
              ))}
              {months.map((m, i) => (
                <div key={`m-${band(i)}`}>
                  <label className="mb-1 block text-caption text-dim" htmlFor={`dm-${i}`}>
                    {s("edge", { n: i + 1 })}
                  </label>
                  <Num
                    id={`dm-${i}`}
                    value={m}
                    min={1}
                    max={cell.window_months}
                    suffix={s("monthUnit")}
                    onChange={(v) =>
                      setDecay({ factors, months: months.map((x, j) => (j === i ? v : x)) })
                    }
                  />
                </div>
              ))}
            </div>
          </Row>
        )}
        <Row label={s("late")} htmlFor="late-day">
          <Num
            id="late-day"
            value={cell.late_per_day}
            min={0}
            max={100}
            suffix={s("perDay")}
            className="max-w-60"
            onChange={(v) => set({ ...cell, late_per_day: v })}
          />
        </Row>
      </Panel>
      <TryBox formula={[s("f1"), s("f2"), s("f3")]}>
        <table className="w-full text-caption">
          <thead>
            <tr className="text-dim">
              <th className="text-left">{s("job")}</th>
              <th className="text-right">{s("age")}</th>
              <th className="text-right">{s("score")}</th>
              <th className="text-right">{s("factor")}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j, i) => (
              <tr key={j.id}>
                <td className="py-1">{s("jobN", { n: i + 1 })}</td>
                <td className="text-right">
                  <TryNum
                    label={s("age")}
                    value={j.age}
                    min={0}
                    max={60}
                    onChange={(v) => setJobs(jobs.map((x, k) => (k === i ? { ...x, age: v } : x)))}
                  />
                </td>
                <td className="text-right">
                  <TryNum
                    label={s("score")}
                    value={j.score}
                    min={0}
                    max={100}
                    onChange={(v) =>
                      setJobs(jobs.map((x, k) => (k === i ? { ...x, score: v } : x)))
                    }
                  />
                </td>
                <td className="text-right tabular-nums">{h[i]}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 border-t border-rule-soft pt-2 text-label">
          {w === null ? (
            <span>{s("allOut")}</span>
          ) : (
            <div className="flex justify-between">
              <span>{s("result")}</span>
              <b data-testid="try-result" className="text-lg tabular-nums">
                {Math.round(w)}
              </b>
            </div>
          )}
          <p className="text-caption text-dim">{s("plain", { v: Math.round(plain * 10) / 10 })}</p>
        </div>
      </TryBox>
    </>
  );
}
