// HD-FR-54 · HD-FR-55 · S05 (không có trong mgmt-app web ⇒ lệch có chủ ý, ẩn ở so ảnh: `data-hd5`): HĐ gốc / các phụ lục /
// bảng giá hiện hành sau khi áp phụ lục. CR-101a: bỏ gắn/gỡ phụ lục (chỉ đọc).
import type { ContractDetail } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { fetchPrices, pricesKey } from "./api";

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

/** CR-101a (Câu 5): phụ lục cũ CHỈ ĐỌC — không gắn/gỡ, không tạo mới; sửa đổi HĐ qua "Tải bản cập nhật" (phiên bản). */
export function AppendixPanel({ c }: { c: ContractDetail; write?: boolean }) {
  const { t } = useTranslation();
  if (!c.parent && c.appendices.length === 0) return null;
  return (
    <section data-hd5="appendix" className="mt-5">
      <Panel className="p-5">
        <h2 className="text-base font-semibold">{t("contracts.appendix.title")}</h2>
        <p data-testid="appendix-readonly" className="mt-1 text-label text-dim">
          {t("contracts.appendix.readOnly")}
        </p>
        {c.parent && (
          <p className="mt-2 text-sm">
            {t("contracts.appendix.parentOf")}{" "}
            <Link to="/contracts/$id" params={{ id: c.parent.id }} className={LINK}>
              {c.parent.title}
            </Link>
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
        <Prices id={c.id} />
      </Panel>
    </section>
  );
}
