// CR-125 · x8 · MỘT ô ngày cho cả app Sổ Hợp Tác (thay `<input type="date">` của trình duyệt — hiện mm/dd theo máy Mỹ): gõ hoặc chọn,
// luôn hiện dd/mm/yyyy qua `viDate` (một bộ định dạng), lịch thứ Hai đầu tuần, tháng tiếng Việt. Giá trị vào/ra vẫn là ISO yyyy-mm-dd
// và `onChange` nhận `{ target: { value } }` như ô gốc ⇒ thay thẳng chỗ dùng cũ.
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { viDate } from "../format";
import {
  addMonths,
  inRange,
  monthGrid,
  parseDate,
  todayVn,
  VI_MONTHS,
  VI_WEEKDAYS,
} from "./date-math";

export type DateInputProps = {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  min?: string | undefined;
  max?: string | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  name?: string | undefined;
  className?: string | undefined;
  placeholder?: string | undefined;
  required?: boolean | undefined;
  "aria-label"?: string | undefined;
  "data-testid"?: string | undefined;
};

/** Lớp của chỗ dùng cũ (`field …`) áp lên ô nhập bên trong; vỏ ngoài chỉ giữ kích thước/khoảng cách. */
const spanClass = (c: string | undefined): string =>
  (c ?? "")
    .split(/\s+/)
    .filter((x) => x && x !== "field" && x !== "font-mono")
    .join(" ");

const show = (iso: string): string => (iso ? viDate(iso) : "");
const emit = (v: string) => ({ target: { value: v } });

function Calendar(p: {
  value: string;
  min?: string | undefined;
  max?: string | undefined;
  onPick: (iso: string) => void;
}) {
  const today = todayVn();
  const base = p.value || today;
  const [view, setView] = useState({ year: +base.slice(0, 4), m0: +base.slice(5, 7) - 1 });
  const go = (n: number) => setView((v) => addMonths(v.year, v.m0, n));
  return (
    <div className="w-[272px] text-[13px]" data-testid="date-popover">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          aria-label="Tháng trước"
          onClick={() => go(-1)}
        >
          <ChevronLeft width={16} height={16} />
        </button>
        <b>
          {VI_MONTHS[view.m0]} {view.year}
        </b>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          aria-label="Tháng sau"
          onClick={() => go(1)}
        >
          <ChevronRight width={16} height={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-dim">
        {VI_WEEKDAYS.map((w) => (
          <span key={w} className="py-1 text-[12px] font-semibold">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
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
                aria-label={viDate(c.iso)}
                aria-pressed={on}
                data-today={c.iso === today || undefined}
                onClick={() => p.onPick(c.iso)}
                className={`h-8 rounded-md tnum ${c.inMonth ? "" : "text-dim/60"} ${
                  on ? "bg-act font-semibold text-white" : "hover:bg-sunk"
                } ${c.iso === today && !on ? "ring-1 ring-act" : ""} disabled:opacity-30`}
              >
                {c.day}
              </button>
            );
          })}
      </div>
      <div className="mt-2 flex justify-between">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => p.onPick(today)}>
          Hôm nay
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => p.onPick("")}>
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
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <span className={`relative inline-flex items-center ${spanClass(p.className)}`.trim()}>
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
            className={`field w-full pr-9 font-mono ${(p.className ?? "")
              .split(/\s+/)
              .filter((x) => x.startsWith("h-"))
              .join(" ")}`.trim()}
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
              className="absolute right-1 grid h-7 w-7 place-items-center rounded text-dim hover:text-ink"
            >
              <CalendarDays width={16} height={16} />
            </button>
          </PopoverPrimitive.Trigger>
        </span>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className="z-50 rounded-lg border border-rule bg-panel p-3 shadow-lg"
        >
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
