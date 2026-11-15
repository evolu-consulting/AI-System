// CR-169 · lát 6 · thanh lọc công ty: «Tất cả» · «<Công ty mình>» · từng công ty đã kết nối; từ công ty thứ 6 ⇒ «Công ty khác ▾» (có tìm + tải dần).
import type { MsgCompany } from "@ai/contracts/pack-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type CompanyFilter as Filter, isCompanyFilter, planChips } from "../lib/company-filter";
import { foldText } from "../lib/format";
import { cn } from "../ui";
import { LoadSentinel } from "./LoadSentinel";

type Props = {
  value: Filter;
  onChange: (f: Filter) => void;
  ownName: string;
  companies: readonly MsgCompany[];
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  /** Công ty đang lọc chưa nằm trong trang đã tải (vào từ `?company=`) ⇒ vẫn hiện thành chip. */
  current?: MsgCompany | null;
};

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid="company-chip"
      onClick={onClick}
      className={cn(
        "h-7 max-w-40 shrink-0 truncate rounded-full border px-3 text-label",
        on
          ? "border-act-line bg-act-soft font-semibold text-ink"
          : "border-rule text-dim hover:bg-sunk",
      )}
    >
      {label}
    </button>
  );
}

function OtherList({ p, onPick }: { p: Props; onPick: (f: Filter) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const needle = foldText(q.trim());
  const shown = needle ? p.companies.filter((c) => foldText(c.name).includes(needle)) : p.companies;
  return (
    <div
      data-testid="company-other-list"
      className="absolute left-3 top-9 z-10 w-64 rounded-lg border border-rule bg-panel p-2 shadow-lg"
    >
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("contracts.messages.filter.search")}
        aria-label={t("contracts.messages.filter.search")}
        className="mb-1 h-8 w-full rounded-md border border-field bg-panel px-2 text-label outline-none focus-visible:border-act-line"
      />
      <ul className="m-0 max-h-56 list-none overflow-y-auto p-0">
        {shown.length === 0 && (
          <li className="px-2 py-2 text-label text-dim">{t("contracts.messages.filter.none")}</li>
        )}
        {shown.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className="w-full truncate rounded-md px-2 py-1.5 text-left text-label hover:bg-sunk"
            >
              {c.name}
            </button>
          </li>
        ))}
      </ul>
      {p.hasMore && <LoadSentinel loading={p.loadingMore} onMore={p.onMore} />}
    </div>
  );
}

export function CompanyFilter(p: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const extra = p.current && !p.companies.some((c) => c.id === p.current?.id) ? [p.current] : [];
  const plan = planChips([...extra, ...p.companies], p.value, p.hasMore);
  const pick = (f: Filter) => {
    setOpen(false);
    p.onChange(f);
  };
  const otherOn = isCompanyFilter(p.value) && !plan.chips.some((c) => c.id === p.value);
  return (
    <fieldset
      aria-label={t("contracts.messages.filter.label")}
      data-testid="company-filter"
      className="relative m-0 flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-0 px-3 pb-2"
    >
      <Chip
        on={p.value === "all"}
        label={t("contracts.messages.filter.all")}
        onClick={() => pick("all")}
      />
      {p.ownName && <Chip on={p.value === "own"} label={p.ownName} onClick={() => pick("own")} />}
      {plan.chips.map((c) => (
        <Chip key={c.id} on={p.value === c.id} label={c.name} onClick={() => pick(c.id)} />
      ))}
      {plan.more && (
        <button
          type="button"
          aria-expanded={open}
          data-testid="company-other"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "h-7 shrink-0 rounded-full border px-3 text-label",
            otherOn ? "border-act-line bg-act-soft" : "border-rule text-dim hover:bg-sunk",
          )}
        >
          {t("contracts.messages.filter.other")} ▾
        </button>
      )}
      {open && <OtherList p={p} onPick={pick} />}
    </fieldset>
  );
}
