// CR-125 · x8/c4 · MỘT ô ngày cho mọi web (workspace, admin…) — thay `<input type="date">` của trình duyệt (hiện mm/dd theo máy Mỹ):
// gõ hoặc chọn, luôn hiện dd/mm/yyyy (`isoToVi`), lịch thứ Hai đầu tuần, tháng tiếng Việt. Giá trị vào/ra vẫn là ISO yyyy-mm-dd và
// `onChange` nhận `{ target: { value } }` như ô gốc ⇒ thay thẳng chỗ dùng cũ. Lịch dùng style nội tuyến + biến màu shadcn
// (`--popover/--border/--primary/--muted…`, có giá trị dự phòng) nên không phụ thuộc Tailwind của app; kiểu ô nhập do app truyền
// (`inputClassName`, mặc định `field` của workspace; admin truyền lớp của `Input`).
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { type CSSProperties, useEffect, useState } from "react";
import {
  addMonths,
  inRange,
  isoToVi,
  monthGrid,
  parseDate,
  todayVn,
  VI_MONTHS,
  VI_WEEKDAYS,
} from "../date-math";

export type DateInputProps = {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  min?: string | undefined;
  max?: string | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  name?: string | undefined;
  /** Lớp bố cục (`w-40`, `flex-1`…) lên vỏ ngoài; lớp còn lại lên ô nhập. */
  className?: string | undefined;
  /** Kiểu ô nhập của app (mặc định `field`). */
  inputClassName?: string | undefined;
  placeholder?: string | undefined;
  required?: boolean | undefined;
  "aria-label"?: string | undefined;
  "data-testid"?: string | undefined;
};

const LAYOUT = /^(?:[a-z]+:)*(?:w-|min-w-|max-w-|flex|grow|shrink|basis-|col-|self-|-?m[trblxy]?-)/;
const split = (c: string | undefined): { wrap: string; input: string } => {
  const all = (c ?? "").split(/\s+/).filter(Boolean);
  return {
    wrap: all.filter((x) => LAYOUT.test(x)).join(" "),
    input: all.filter((x) => !LAYOUT.test(x)).join(" "),
  };
};

const show = (iso: string): string => (iso ? isoToVi(iso) : "");
const emit = (v: string) => ({ target: { value: v } });
const v = (name: string, dflt: string): string => `var(${name}, ${dflt})`;

const S = {
  panel: {
    zIndex: 60,
    borderRadius: 8,
    border: `1px solid ${v("--border", "#e5e5e5")}`,
    background: v("--popover", "#fff"),
    color: v("--popover-foreground", v("--foreground", "inherit")),
    padding: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,.18)",
  } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  grid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", rowGap: 2 },
  wk: {
    textAlign: "center",
    padding: "4px 0",
    fontSize: 12,
    fontWeight: 600,
    color: v("--muted-foreground", "#6b6b6b"),
  },
  nav: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: 6,
    border: 0,
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  foot: { display: "flex", justifyContent: "space-between", marginTop: 8 },
  link: {
    border: 0,
    background: "transparent",
    color: v("--primary", "#4f46e5"),
    cursor: "pointer",
    fontSize: 13,
    padding: "4px 6px",
  },
} satisfies Record<string, CSSProperties>;

const dayStyle = (
  c: { inMonth: boolean },
  on: boolean,
  today: boolean,
  off: boolean,
): CSSProperties => ({
  height: 32,
  border: 0,
  borderRadius: 6,
  cursor: off ? "default" : "pointer",
  opacity: off ? 0.3 : c.inMonth ? 1 : 0.5,
  fontVariantNumeric: "tabular-nums",
  fontWeight: on ? 600 : 400,
  background: on ? v("--primary", "#4f46e5") : "transparent",
  color: on ? v("--primary-foreground", "#fff") : "inherit",
  boxShadow: today && !on ? `inset 0 0 0 1px ${v("--primary", "#4f46e5")}` : "none",
});

function Calendar(p: {
  value: string;
  min?: string | undefined;
  max?: string | undefined;
  onPick: (iso: string) => void;
}) {
  const today = todayVn();
  const base = p.value || today;
  const [view, setView] = useState({ year: +base.slice(0, 4), m0: +base.slice(5, 7) - 1 });
  const go = (n: number) => setView((x) => addMonths(x.year, x.m0, n));
  return (
    <div style={{ width: 272, fontSize: 13 }} data-testid="date-popover">
      <div style={S.head}>
        <button type="button" style={S.nav} aria-label="Tháng trước" onClick={() => go(-1)}>
          <ChevronLeft width={16} height={16} />
        </button>
        <b>
          {VI_MONTHS[view.m0]} {view.year}
        </b>
        <button type="button" style={S.nav} aria-label="Tháng sau" onClick={() => go(1)}>
          <ChevronRight width={16} height={16} />
        </button>
      </div>
      <div style={S.grid}>
        {VI_WEEKDAYS.map((w) => (
          <span key={w} style={S.wk}>
            {w}
          </span>
        ))}
      </div>
      <div style={S.grid}>
        {monthGrid(view.year, view.m0)
          .flat()
          .map((c) => {
            const off = !inRange(c.iso, p.min, p.max);
            const on = c.iso === p.value;
            return (
              <button
                key={c.iso}
                type="button"
                disabled={off}
                aria-label={isoToVi(c.iso)}
                aria-pressed={on}
                data-today={c.iso === today || undefined}
                onClick={() => p.onPick(c.iso)}
                style={dayStyle(c, on, c.iso === today, off)}
              >
                {c.day}
              </button>
            );
          })}
      </div>
      <div style={S.foot}>
        <button type="button" style={S.link} onClick={() => p.onPick(today)}>
          Hôm nay
        </button>
        <button type="button" style={S.link} onClick={() => p.onPick("")}>
          Xoá
        </button>
      </div>
    </div>
  );
}

export function DateInput(p: DateInputProps) {
  const [text, setText] = useState(show(p.value));
  const [open, setOpen] = useState(false);
  useEffect(() => setText(show(p.value)), [p.value]);
  const commit = (raw: string) => {
    const iso = parseDate(raw);
    if (iso && inRange(iso, p.min, p.max)) p.onChange(emit(iso));
  };
  const cls = split(p.className);
  const inputCls = `${p.inputClassName ?? "field"} ${cls.input}`.trim();
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <span
          className={cls.wrap}
          style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
        >
          <input
            id={p.id}
            name={p.name}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={p.placeholder ?? "dd/mm/yyyy"}
            required={p.required}
            disabled={p.disabled}
            aria-label={p["aria-label"]}
            data-testid={p["data-testid"]}
            className={inputCls}
            style={{ width: "100%", paddingRight: 36 }}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              commit(e.target.value);
            }}
            onBlur={() => {
              if (text.trim() === "") p.onChange(emit(""));
              else setText(show(p.value));
            }}
          />
          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              disabled={p.disabled}
              aria-label="Chọn ngày"
              style={{
                position: "absolute",
                right: 4,
                display: "grid",
                placeItems: "center",
                width: 28,
                height: 28,
                border: 0,
                background: "transparent",
                color: v("--muted-foreground", "#6b6b6b"),
                cursor: p.disabled ? "default" : "pointer",
              }}
            >
              <CalendarDays width={16} height={16} />
            </button>
          </PopoverPrimitive.Trigger>
        </span>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="start" sideOffset={6} style={S.panel}>
          <Calendar
            value={p.value}
            min={p.min}
            max={p.max}
            onPick={(iso) => {
              p.onChange(emit(iso));
              setOpen(false);
            }}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
