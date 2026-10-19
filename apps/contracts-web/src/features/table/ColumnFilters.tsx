// PK-FR-10 · TF6 · lọc theo cột: chip các điều kiện đã thêm, "+ Lọc" chọn cột khác, "Xoá lọc". Nguồn: table.tsx:267-285, 336-377.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { RangeEditor, summaryOf, ValuesEditor } from "./CondEditors";
import { type Cond, type FilterDef, type FilterState, isSet, matches } from "./lib";
import { PILL, PILL_OFF, PILL_ON, Pop } from "./Pop";

/** Một điều kiện đã thêm: "Bên bán: Nhựa Đông Á +1 ×"; bấm mở ô sửa, × bỏ nó. */
function CondChip({
  def,
  cond,
  set,
  remove,
  fresh,
}: {
  def: FilterDef;
  cond: Cond | undefined;
  set: (c: Cond) => void;
  remove: () => void;
  fresh: boolean;
}) {
  const { t } = useTranslation();
  const on = isSet(cond);
  return (
    <Pop
      startOpen={fresh}
      button={(open, toggle) => (
        <span className={cn(PILL, "pr-1", on ? PILL_ON : PILL_OFF)}>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={t("contracts.table.editFilter", { name: def.label })}
            className="max-w-[220px] truncate"
          >
            {def.label}: <span className={on ? "" : "text-dim"}>{summaryOf(def, cond, t, on)}</span>
          </button>
          <button
            type="button"
            onClick={remove}
            aria-label={t("contracts.table.removeFilter", { name: def.label })}
            className="grid h-6 w-6 place-items-center rounded-full text-caption opacity-70 hover:bg-black/5 hover:opacity-100"
          >
            ✕
          </button>
        </span>
      )}
    >
      {def.kind === "number" ? (
        <RangeEditor cond={cond} set={set} />
      ) : (
        <ValuesEditor def={def} cond={cond} set={set} />
      )}
    </Pop>
  );
}

export function ColumnFilters({ filter }: { filter: FilterState }) {
  const { t } = useTranslation();
  const [last, setLast] = useState<string | null>(null); // chip vừa thêm mở ô sửa ngay
  const [find, setFind] = useState("");
  const free = filter.defs.filter(
    (d) => !filter.active.includes(d.key) && (d.kind === "number" || d.options.length),
  );
  const byKey = new Map(filter.defs.map((d) => [d.key, d]));
  return (
    <>
      {filter.active.map((k) => {
        const def = byKey.get(k);
        return (
          def && (
            <CondChip
              key={k}
              def={def}
              cond={filter.conds[k]}
              fresh={k === last}
              set={(c) => filter.set(k, c)}
              remove={() => filter.remove(k)}
            />
          )
        );
      })}
      {free.length > 0 && (
        <Pop
          button={(open, toggle) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className={cn(PILL, PILL_OFF, "border-dashed")}
            >
              {filter.active.length ? t("contracts.table.addFilter") : t("contracts.table.filter")}
            </button>
          )}
        >
          {(close) => (
            <>
              <p className="px-2 pt-1 pb-1.5 text-micro font-medium tracking-wide text-dim uppercase">
                {t("contracts.table.filterBy")}
              </p>
              {free.length > 6 && (
                <input
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder={t("contracts.table.findColumn")}
                  aria-label={t("contracts.table.findColumn")}
                  className="mb-1 h-8 w-full rounded-lg border border-field bg-panel px-3 text-label text-ink"
                />
              )}
              {free
                .filter((d) => matches(d.label, find))
                .map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[13.5px] hover:bg-sunk"
                    onClick={() => {
                      filter.add(d.key);
                      setLast(d.key);
                      setFind("");
                      close();
                    }}
                  >
                    {d.label}
                    <span className="ml-auto text-caption text-dim">
                      {d.kind === "number"
                        ? t("contracts.table.range")
                        : t("contracts.table.valueCount", { n: d.options.length })}
                    </span>
                  </button>
                ))}
            </>
          )}
        </Pop>
      )}
      {filter.active.length > 0 && (
        <button
          type="button"
          className="px-1 text-label text-dim hover:text-ink-2 hover:underline"
          onClick={filter.clear}
        >
          {t("contracts.table.clearFilters")}
        </button>
      )}
    </>
  );
}
