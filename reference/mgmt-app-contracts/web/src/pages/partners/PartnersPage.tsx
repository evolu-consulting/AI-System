import { useState } from "react";
import { Link } from "react-router";
import { usePartnerRatings, usePartners, useScoring, type Role } from "@/api/partners";
import PartnerLog from "./PartnerLog";
import PartnerRatings from "./PartnerRatings";
import { ColumnFilters, Pager, TableTools, useTable } from "@/components/table";
import { Empty, ErrorLine, Loading, PageHead, Panel, ScoreBadge } from "@/components/ui";

const ROLE_WORD: Record<Role, string> = { customer: "Khách hàng", supplier: "Nhà cung cấp" };
const BAND_WORD: Record<string, string> = { good: "Tốt", fair: "Khá", watch: "Chú ý" };

/** A person's own ratings of one partner, or where to add a criterion to rate when there is none yet. */
function Ratings({ companyId, role }: { companyId: string; role: Role }) {
  const q = usePartnerRatings(companyId, role);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorLine error={q.error} />;
  if (!q.data?.criteria.length) {
    return (
      <p className="text-[13px] text-dim">
        Chưa có tiêu chí tự chấm cho {ROLE_WORD[role].toLowerCase()}. Thêm ở{" "}
        <Link to="/settings/scoring" className="font-semibold text-act underline underline-offset-2">Cách tính điểm uy tín</Link>{" "}
        (vd “Chất lượng hàng”), rồi quay lại chấm 0–100.
      </p>
    );
  }
  return <PartnerRatings companyId={companyId} role={role} />;
}

/** p02 · Đối tác: one row per partner with its reputation and the one fact that explains it. */
export default function PartnersPage() {
  const q = usePartners("all");
  const months = useScoring("customer").data?.rules.window_months ?? 12;     // as set in Cách tính điểm
  const t = useTable(q.data, {
    key: "partners",          // the assistant can filter this table (filter_table) and sees what it shows
    describe: (p) => `${p.name} · ${ROLE_WORD[p.role]} · ${p.score ?? "chưa có"} điểm · ${p.reason} · id ${p.company_id}`,
    text: (p) => `${p.name} ${ROLE_WORD[p.role]} ${p.reason}`,
    filters: [
      { key: "role", label: "Vai trò", value: (p) => ROLE_WORD[p.role] },
      { key: "band", label: "Mức điểm", value: (p) => BAND_WORD[p.band ?? ""] ?? "Chưa có điểm" },
    ],
  });
  // one partner open at a time, on its "+ Ghi việc" or its "Chấm điểm"
  const [open, setOpen] = useState<{ key: string; what: "log" | "rate" } | null>(null);

  return (
    <>
      <PageHead title="Đối tác" titleMobileOnly />
      <TableTools q={t.q} setQ={t.setQ} total={t.total} placeholder="Tìm theo tên đối tác…">
        <ColumnFilters filter={t.filter} />
      </TableTools>
      <Panel className="md:flex md:min-h-0 md:flex-1 md:flex-col">
        {q.isLoading ? <Loading /> : q.error ? <ErrorLine error={q.error} /> : !q.data?.length ? (
          <Empty title="Chưa có đối tác">Đối tác tự xuất hiện khi có hợp đồng.</Empty>
        ) : !t.total ? (
          <Empty title="Không có đối tác khớp">Thử từ khoá khác.</Empty>
        ) : (
          <ul className="md:min-h-0 md:flex-1 md:overflow-auto">
            {t.shown.map((p) => {
              const key = `${p.company_id}:${p.role}`;
              return (
                <li key={key} className={`border-b border-rule-soft last:border-0 ${p.band === "watch" ? "bg-soon-bg/50" : ""}`}>
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    <ScoreBadge score={p.score} band={p.band} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="block truncate text-[13px] text-dim">{ROLE_WORD[p.role]} · {p.reason}</span>
                    </span>
                    <span className="ml-auto flex shrink-0 gap-1.5">
                      {(["log", "rate"] as const).map((what) => {
                        const on = open?.key === key && open.what === what;
                        return (
                          <button key={what} type="button" className={`btn h-9 text-[13px] ${on ? "btn-outline" : "btn-quiet"}`} aria-expanded={on}
                            onClick={() => setOpen(on ? null : { key, what })}>
                            {on ? "Đóng" : what === "log" ? "+ Ghi việc" : "Chấm điểm"}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                  {open?.key === key && (
                    <div className="px-5 pb-4">
                      {open.what === "log" ? <PartnerLog companyId={p.company_id} role={p.role} />
                        : <Ratings companyId={p.company_id} role={p.role} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Pager t={t} />
      </Panel>
      <p className="mt-4 text-[13px] text-dim">
        Điểm tính lại mỗi lần mở trang, từ thanh toán, giao hàng, số lần nhắc, giữ lịch hẹn, giá và điểm tự chấm trong {months} tháng gần nhất.{" "}
        <Link to="/settings/scoring" className="font-semibold text-act underline underline-offset-2">⚙ Cách tính điểm</Link>
      </p>
    </>
  );
}
