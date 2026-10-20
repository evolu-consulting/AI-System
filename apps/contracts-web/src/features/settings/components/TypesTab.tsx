// V2-L · CD-04: tab "Loại việc" — danh mục việc ghi tay (HD-06) gắn vào tiêu chí của ô: tên, tiêu chí, điểm việc (0 = việc xấu đếm).
// Danh mục dùng chung mọi ô (lưu một lần `PUT /reputation/config/job-types`); tab chỉ hiện các loại gắn với tiêu chí của ô này.
import { useTranslation } from "react-i18next";
import { slugKey } from "../lib/data";
import type { Cell, JobType } from "../lib/types";
import { FIELD, Num, Panel } from "./controls";

export function TypesTab({
  cell,
  types,
  set,
}: {
  cell: Cell;
  types: JobType[];
  set: (t: JobType[]) => void;
}) {
  const { t } = useTranslation();
  const s = (k: string) => t(`contracts.settings.types.${k}`);
  const keys = cell.criteria
    .filter((c) => c.kind === "jobs" || c.kind === "bad_count")
    .map((c) => c.key);
  const mine = types.filter((x) => keys.includes(x.criterion));
  const patch = (key: string, p: Partial<JobType>) =>
    set(types.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const add = () => {
    const taken = types.map((x) => x.key);
    const key = slugKey(s("newName"), taken).replace("custom:", "job-");
    set([...types, { key, name: s("newName"), criterion: keys[0] ?? "", score: 50 }]);
  };
  return (
    <Panel
      title={s("title")}
      sub={s("hint")}
      action={
        <button
          type="button"
          disabled={!keys.length || types.length >= 50}
          onClick={add}
          className="h-8 rounded-lg border border-act px-3 text-label text-act hover:bg-act-soft disabled:opacity-50"
        >
          {s("add")}
        </button>
      }
    >
      {mine.length === 0 && <p className="px-5 py-4 text-caption text-dim">{s("empty")}</p>}
      {mine.map((x) => (
        <div
          key={x.key}
          className="grid grid-cols-[1fr_200px_120px_auto] items-center gap-3 border-t border-rule-soft px-5 py-3 first:border-t-0 max-md:grid-cols-1"
        >
          <input
            aria-label={s("name")}
            className={FIELD}
            maxLength={80}
            value={x.name}
            onChange={(e) => patch(x.key, { name: e.target.value })}
          />
          <select
            aria-label={s("criterion")}
            className={FIELD}
            value={x.criterion}
            onChange={(e) => patch(x.key, { criterion: e.target.value })}
          >
            {cell.criteria
              .filter((c) => keys.includes(c.key))
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
          </select>
          <Num
            value={x.score}
            min={0}
            max={100}
            suffix={s("points")}
            onChange={(v) => patch(x.key, { score: v })}
          />
          <button
            type="button"
            className="text-caption text-late hover:underline"
            onClick={() => set(types.filter((y) => y.key !== x.key))}
          >
            {s("remove")}
          </button>
        </div>
      ))}
    </Panel>
  );
}
