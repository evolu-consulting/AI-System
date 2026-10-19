// HD-FR-54 · HD-FR-55 · S05 (không có trong mgmt-app web ⇒ lệch có chủ ý, ẩn ở so ảnh: `data-hd5`): HĐ gốc / các phụ lục /
// gắn làm phụ lục (gợi ý + tìm tay) / bảng giá hiện hành sau khi áp phụ lục.
import type { ContractDetail } from "@ai/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { contractKey } from "~/features/contract-review/api";
import { saveErrorText } from "~/features/contract-review/lib/save-error";
import {
  attachParent,
  fetchPrices,
  fetchSuggestions,
  pricesKey,
  searchParents,
  suggestionsKey,
} from "./api";

const LINK = "font-medium text-act hover:underline";

function Prices({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: pricesKey(id), queryFn: ({ signal }) => fetchPrices(id, signal) });
  if (!q.data?.lines.length) return null;
  return (
    <div className="mt-4 overflow-auto">
      <h3 className="mb-1.5 text-sm font-semibold">{t("contracts.appendix.prices")}</h3>
      <table className="w-full text-[13px]">
        <thead className="text-left text-[12px] text-dim">
          <tr>
            <th className="py-1.5 pr-3 font-medium">{t("contracts.appendix.item")}</th>
            <th className="py-1.5 pr-3 text-right font-medium">{t("contracts.appendix.price")}</th>
            <th className="py-1.5 pr-3 font-medium">{t("contracts.appendix.validity")}</th>
            <th className="py-1.5 font-medium">{t("contracts.appendix.source")}</th>
          </tr>
        </thead>
        <tbody>
          {q.data.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: dòng giá không có định danh riêng
            <tr key={i} className={l.current ? "" : "text-dim"}>
              <td className="py-1.5 pr-3">{l.item.name}</td>
              <td className="py-1.5 pr-3 text-right font-mono">
                {l.item.unit_price != null ? `${vnd(l.item.unit_price)} đ` : "—"}
              </td>
              <td className="py-1.5 pr-3 whitespace-nowrap">
                {viDate(l.valid_from)} –{" "}
                {l.valid_to ? viDate(l.valid_to) : t("contracts.appendix.open")}
              </td>
              <td className="py-1.5">
                {l.source.kind === "appendix"
                  ? t("contracts.appendix.fromAppendix", { title: l.source.title })
                  : t("contracts.appendix.fromContract")}
                {l.superseded_by ? ` · ${t("contracts.appendix.replaced")}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Attach({ c, onDone }: { c: ContractDetail; onDone: (e?: string) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const sug = useQuery({
    queryKey: suggestionsKey(c.id),
    queryFn: ({ signal }) => fetchSuggestions(c.id, signal),
  });
  const found = useQuery({
    queryKey: ["contract", c.id, "parent-search", text],
    queryFn: ({ signal }) => searchParents(text.trim(), signal),
    enabled: text.trim().length >= 2,
  });
  const pick = async (parentId: string) => {
    try {
      await attachParent(c.id, c.version, parentId);
      onDone();
    } catch (e) {
      onDone(saveErrorText(e, t));
    }
  };
  const options = [
    ...(sug.data?.items ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      number: s.number,
      why: t(`contracts.appendix.why.${s.reason}`),
    })),
    ...(found.data?.items ?? [])
      .filter((r) => r.id !== c.id)
      .map((r) => ({ id: r.id, title: r.title, number: r.number, why: "" })),
  ].filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i);
  return (
    <div className="mt-3">
      <label className="flex flex-col gap-1 text-sm">
        {t("contracts.appendix.attachLabel")}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("contracts.appendix.search")}
          className="h-9 max-w-sm rounded-lg border border-field bg-panel px-3 text-label text-ink"
        />
      </label>
      <ul className="mt-2 flex flex-col gap-1">
        {options.map((o) => (
          <li key={o.id}>
            <button type="button" className={`${LINK} text-left`} onClick={() => void pick(o.id)}>
              {o.title}
              {o.number ? ` · ${o.number}` : ""}
            </button>
            {o.why && <span className="ml-2 text-label text-dim">{o.why}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AppendixPanel({ c, write }: { c: ContractDetail; write: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const refresh = async (e?: string) => {
    setErr(e ?? null);
    setOpen(false);
    await qc.invalidateQueries({ queryKey: contractKey(c.id) });
    await qc.invalidateQueries({ queryKey: ["contract", c.id] });
  };
  const detach = async () => {
    try {
      await attachParent(c.id, c.version, null);
      await refresh();
    } catch (e) {
      await refresh(saveErrorText(e, t));
    }
  };
  const canAttach = write && !c.parent && c.appendices.length === 0 && c.status !== "extracting";
  if (!c.parent && c.appendices.length === 0 && !canAttach) return null;
  return (
    <section data-hd5="appendix" className="mt-5">
      <Panel className="p-5">
        <h2 className="text-base font-semibold">{t("contracts.appendix.title")}</h2>
        {err && (
          <p role="alert" className="mt-2 text-sm text-late">
            {err}
          </p>
        )}
        {c.parent && (
          <p className="mt-2 text-sm">
            {t("contracts.appendix.parentOf")}{" "}
            <Link to="/contracts/$id" params={{ id: c.parent.id }} className={LINK}>
              {c.parent.title}
            </Link>
            {write && (
              <button
                type="button"
                className="ml-3 text-label text-dim hover:underline"
                onClick={() => void detach()}
              >
                {t("contracts.appendix.detach")}
              </button>
            )}
          </p>
        )}
        {c.appendices.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {c.appendices.map((a) => (
              <li key={a.id}>
                <Link to="/contracts/$id" params={{ id: a.id }} className={LINK}>
                  {a.title}
                </Link>
                <span className="ml-2 text-label text-dim">
                  {a.effective_date
                    ? t("contracts.appendix.effective", { date: viDate(a.effective_date) })
                    : t("contracts.appendix.noDate")}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canAttach &&
          (open ? (
            <Attach c={c} onDone={(e) => void refresh(e)} />
          ) : (
            <button type="button" className={`${LINK} mt-2 text-sm`} onClick={() => setOpen(true)}>
              {t("contracts.appendix.attach")}
            </button>
          ))}
        {(c.appendices.length > 0 || c.parent) && <Prices id={c.id} />}
      </Panel>
    </section>
  );
}
