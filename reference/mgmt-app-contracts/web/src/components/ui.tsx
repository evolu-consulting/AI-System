import type { ReactNode } from "react";

export const vnd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("vi-VN"));
/** "2026-10-16" → "16/10/2026". A timestamp ("2026-10-15T23:30:00+00:00", stored in UTC) is first put on Vietnam's
 *  clock, so a save at 06:00 in Hà Nội shows that day, not the day before. */
export const viDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const day = iso.length > 10 && iso.includes("T")
    ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })
    : iso.slice(0, 10);
  return day.split("-").reverse().join("/");
};

/** Numbers as Vietnamese people type them: "." groups thousands, "," is the decimal mark.
 *  Money and counts in đồng: every non-digit dropped ("91.500.000 đ" → 91500000). Empty → null; junk → NaN. */
export const parseMoney = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const digits = t.replace(/\D/g, "");
  return digits ? Number(digits) : NaN;
};
/** A quantity that may have a decimal part: "1.500" → 1500, "1,5" → 1.5. Empty → null; junk → NaN. */
export const parseQty = (s: string): number | null => {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d+\.(\d{1,2}|\d{4,})$/.test(t)) return Number(t);      // a machine's decimal ("1.5" the assistant filled in)
  return NaN;
};

/** Status words carry their own tone, as on the mock: amber when soon, red when late, grey otherwise. */
export type Tone = "late" | "soon" | "ok" | "dim" | "act";
export const TONE_TEXT: Record<Tone, string> = {
  late: "font-semibold text-late", soon: "font-semibold text-soon", ok: "font-semibold text-ok", dim: "text-dim", act: "text-act",
};

/** The in-page heading row. On wide screens the section name already shows in the top bar, so a list page passes
 *  `titleMobileOnly` to keep its H1 only on phones (where the top bar shows the app name instead) and avoid showing
 *  the same word twice. `title` is optional — pages that carry only controls/actions can omit it. */
export function PageHead({ title, lead, crumb, actions, titleMobileOnly }: {
  title?: ReactNode; lead?: ReactNode; crumb?: ReactNode; actions?: ReactNode; titleMobileOnly?: boolean;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-4">
      {(crumb || title || lead) && (
        <div className="flex min-w-0 flex-col gap-1">
          {crumb && <nav aria-label="Vị trí" className="text-[13px] text-dim">{crumb}</nav>}
          {title && <h1 className={`text-[26px] font-semibold tracking-[-0.01em] max-sm:text-[22px] ${titleMobileOnly ? "md:hidden" : ""}`}>{title}</h1>}
          {lead && <p className="text-sm text-dim">{lead}</p>}
        </div>
      )}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`overflow-hidden rounded-xl border border-rule bg-panel ${className}`}>{children}</section>;
}

export function Chips<T extends string>({ items, value, onChange, extra, label }: {
  items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; extra?: ReactNode; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="mb-4 flex flex-wrap gap-2">
      {items.map((i) => (
        <button key={i.id} type="button" className="chip" aria-pressed={value === i.id} onClick={() => onChange(i.id)}>
          {i.label}
        </button>
      ))}
      {extra}
    </div>
  );
}

/** Nothing to show — no data yet, or nothing matched a search. A magnifier reads as "we looked and found none";
 *  pass `icon` to override. */
export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span aria-hidden className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-sunk text-dim">
        {icon ?? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
        )}
      </span>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-dim">{children}</div>}
    </div>
  );
}

/** A spinning ring (currentColor); reduced-motion stops the spin, leaving a quiet ring (index.css). */
export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Loading() {
  return (
    <div role="status" aria-label="Đang tải" className="flex justify-center px-6 py-10 text-act">
      <Spinner />
    </div>
  );
}

/** A soft placeholder block for the shape of content still loading, so numbers and rows fade in instead of jumping
 *  from a dash. Reduced-motion turns the pulse off globally (index.css). Size it with className (h-/w-). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-rule-soft ${className}`} />;
}

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="px-6 py-4 text-sm text-late">{error instanceof Error ? error.message : String(error)}</p>;
}

/** Reputation badge (p02): number over band, coloured by band; a dash when there is not enough to score. */
export type Band = "good" | "fair" | "watch";
const BAND = { good: ["bg-ok-bg text-ok", "TỐT"], fair: ["bg-idle-bg text-ink-2", "KHÁ"], watch: ["bg-soon-bg text-soon", "CHÚ Ý"] } as const;
export const BAND_LABEL: Record<Band, string> = { good: "Tốt", fair: "Khá", watch: "Chú ý" };
export const BAND_TEXT: Record<Band, string> = { good: "text-ok", fair: "text-ink-2", watch: "text-soon" };

export function ScoreBadge({ score, band }: { score: number | null; band: Band | null }) {
  if (score == null || !band) {
    return <span className="grid h-12 w-[54px] shrink-0 place-items-center rounded-lg border border-dashed border-field text-lg text-dim"
      aria-label="Chưa đủ dữ liệu để chấm">–</span>;
  }
  const [cls, word] = BAND[band];
  return (
    <span className={`flex h-12 w-[54px] shrink-0 flex-col items-center justify-center rounded-lg ${cls}`}>
      <span className="tnum text-lg leading-none font-semibold">{score}</span>
      <span className="mt-0.5 text-[10px] font-semibold tracking-wide">{word}</span>
    </span>
  );
}

export function Stat({ value, label, tone, loading }: { value: ReactNode; label: string; tone?: "soon" | "late"; loading?: boolean }) {
  const cls = tone === "soon" ? "border-soon-line bg-soon-bg text-soon" : tone === "late" ? "border-late-line bg-late-bg text-late" : "border-rule bg-panel";
  return (
    <div className={`rounded-xl border px-4 py-3.5 ${cls}`}>
      <p className="tnum text-[26px] leading-tight font-medium">{loading ? <Skeleton className="my-1 h-6 w-14" /> : value}</p>
      <p className={`text-[13px] ${tone ? "" : "text-dim"}`}>{label}</p>
    </div>
  );
}
