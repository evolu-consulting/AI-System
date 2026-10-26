// CR-097 G2: thanh lọc danh sách giao dịch — tìm đối tác, trạng thái, loại, HĐ, khoảng ngày (trạng thái giữ ở trang).
import { useTranslation } from "react-i18next";
import { hasFilter, type TxFilter } from "../lib/transactions";

type Props = {
  f: TxFilter;
  q: string;
  setQ: (q: string) => void;
  set: (p: Partial<TxFilter>) => void;
  clear: () => void;
  contractOptions: readonly { id: string; label: string }[];
};

const sel = "field h-[2.2rem] w-auto min-w-[130px]";

export function TxFilters({ f, q, setQ, set, clear, contractOptions }: Props) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.txn.${k}`);
  return (
    <section className="mb-3 flex flex-wrap items-center gap-2" aria-label={L("filters")}>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={L("filter.search")}
        aria-label={L("filter.search")}
        className="field h-[2.2rem] w-[220px]"
      />
      <select
        aria-label={L("filter.status")}
        value={f.status}
        onChange={(e) => set({ status: e.target.value as TxFilter["status"] })}
        className={sel}
      >
        <option value="">{L("filter.anyStatus")}</option>
        {(["draft", "posted", "cancelled"] as const).map((s) => (
          <option key={s} value={s}>
            {L(`status.${s}`)}
          </option>
        ))}
      </select>
      <select
        aria-label={L("filter.deal")}
        value={f.deal}
        onChange={(e) => set({ deal: e.target.value as TxFilter["deal"] })}
        className={sel}
      >
        <option value="">{L("filter.anyDeal")}</option>
        <option value="sell">{L("deal.sell")}</option>
        <option value="buy">{L("deal.buy")}</option>
      </select>
      <select
        aria-label={L("filter.contract")}
        value={f.contract_id}
        onChange={(e) => set({ contract_id: e.target.value })}
        className={`${sel} max-w-[240px]`}
      >
        <option value="">{L("filter.anyContract")}</option>
        {f.contract_id && !contractOptions.some((c) => c.id === f.contract_id) && (
          <option value={f.contract_id}>{f.contract_id.slice(0, 8)}</option>
        )}
        {contractOptions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-[13px] text-dim">
        {L("filter.from")}
        <input
          type="date"
          value={f.from}
          onChange={(e) => set({ from: e.target.value })}
          className="field h-[2.2rem]"
        />
      </label>
      <label className="flex items-center gap-1 text-[13px] text-dim">
        {L("filter.to")}
        <input
          type="date"
          value={f.to}
          onChange={(e) => set({ to: e.target.value })}
          className="field h-[2.2rem]"
        />
      </label>
      {hasFilter(f) && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            clear();
          }}
        >
          {L("filter.clear")}
        </button>
      )}
    </section>
  );
}
