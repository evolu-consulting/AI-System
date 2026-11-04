// V2-J1 · SP-07: tab "Hợp đồng · n" của chi tiết sản phẩm — HĐ có dòng gắn SP (loại, đối tác, giá trị; Giới thiệu: hoa hồng nhận / phát sinh).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { Tag } from "~/components/shared/tag";
import { useBizContracts } from "../hooks/use-business";

export function ProductContracts({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useBizContracts(id);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorLine error={q.error} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <Empty title={t("contracts.catalog.con.empty")} />;
  const referral = items.some((c) => c.deal === "referral");
  const cols = ["title", "deal", "partner", "value", "start", ...(referral ? ["commission"] : [])];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[14px]">
        <thead className="border-b border-rule text-[12px] text-dim">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-4 py-2.5 font-medium">
                {t(`contracts.catalog.con.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-b border-rule-soft last:border-0">
              <td className="px-4 py-2.5">
                <Link
                  to="/contracts/$id"
                  params={{ id: c.id }}
                  className="font-medium text-act hover:underline"
                >
                  {c.title}
                </Link>
                {c.number && <span className="block text-[12px] text-dim">{c.number}</span>}
              </td>
              <td className="px-4 py-2.5">
                {c.deal ? (
                  <Tag tone="grey">{t(`contracts.catalog.con.dealWord.${c.deal}`)}</Tag>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-2.5">{c.partner ?? "—"}</td>
              <td className="tnum px-4 py-2.5">{c.value === null ? "—" : `${vnd(c.value)} đ`}</td>
              <td className="px-4 py-2.5">{viDate(c.start_date)}</td>
              {referral && (
                <td className="tnum px-4 py-2.5">
                  {c.commission_total === null
                    ? "—"
                    : `${vnd(c.commission_received)} / ${vnd(c.commission_total)} đ`}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
