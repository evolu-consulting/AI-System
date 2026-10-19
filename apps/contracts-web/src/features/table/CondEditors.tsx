// PK-FR-10 · TF6 · ô sửa điều kiện lọc: danh sách giá trị để tích, và khoảng từ–đến cho cột số. Nguồn: table.tsx:215-265.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type Cond, type FilterDef, matches } from "./lib";

const num = (n: number) => n.toLocaleString("vi-VN");

/** Chữ trên chip sau tên cột: giá trị đầu (+ còn bao nhiêu), hoặc khoảng. */
export function summaryOf(
  def: FilterDef,
  c: Cond | undefined,
  t: (k: string, o?: Record<string, unknown>) => string,
  set: boolean,
): string {
  if (!set || !c) return t("contracts.table.pick");
  if (def.kind === "number") {
    if (c.min != null && c.max != null) return `${num(c.min)} – ${num(c.max)}`;
    return c.min != null
      ? t("contracts.table.from", { value: num(c.min) })
      : t("contracts.table.to", { value: num(c.max as number) });
  }
  const first = c.in?.[0] ?? "";
  return (c.in?.length ?? 0) > 1 ? `${first} +${(c.in?.length ?? 1) - 1}` : first;
}

/** Lựa chọn để tích (có ô tìm khi dài). */
export function ValuesEditor({
  def,
  cond,
  set,
}: {
  def: FilterDef;
  cond: Cond | undefined;
  set: (c: Cond) => void;
}) {
  const { t } = useTranslation();
  const [find, setFind] = useState("");
  const chosen = cond?.in ?? [];
  const opts = def.options.filter((o) => matches(o, find));
  return (
    <>
      {def.options.length > 6 && (
        <input
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder={t("contracts.table.findIn", { name: def.label.toLowerCase() })}
          aria-label={t("contracts.table.findIn", { name: def.label.toLowerCase() })}
          className="mb-1 h-8 w-full rounded-lg border border-field bg-panel px-3 text-label text-ink"
        />
      )}
      <div className="max-h-64 overflow-y-auto">
        {opts.map((o) => (
          <label
            key={o}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-sunk"
          >
            <input
              type="checkbox"
              checked={chosen.includes(o)}
              className="h-4 w-4 accent-[var(--color-act)]"
              onChange={() =>
                set({ in: chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o] })
              }
            />
            <span className="min-w-0 truncate" title={o}>
              {o}
            </span>
          </label>
        ))}
        {!opts.length && (
          <p className="px-2 py-1.5 text-label text-dim">{t("contracts.table.noOptions")}</p>
        )}
      </div>
    </>
  );
}

const parse = (s: string): number | null =>
  s.replace(/\D/g, "") ? Number(s.replace(/\D/g, "")) : null;

/** Từ – đến, cho cột số (gõ có hoặc không có dấu chấm nghìn). */
export function RangeEditor({ cond, set }: { cond: Cond | undefined; set: (c: Cond) => void }) {
  const { t } = useTranslation();
  const box = (label: string, v: number | null | undefined, on: (n: number | null) => void) => (
    <label className="flex flex-1 flex-col gap-1 text-caption text-dim">
      {label}
      <input
        inputMode="numeric"
        className="h-8 w-full rounded-lg border border-field bg-panel px-3 font-mono text-label text-ink"
        value={v == null ? "" : num(v)}
        onChange={(e) => on(parse(e.target.value))}
      />
    </label>
  );
  return (
    <div className="flex gap-2 p-1">
      {box(t("contracts.table.rangeFrom"), cond?.min, (n) => set({ ...cond, min: n }))}
      {box(t("contracts.table.rangeTo"), cond?.max, (n) => set({ ...cond, max: n }))}
    </div>
  );
}
