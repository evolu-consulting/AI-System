// PK-FR-10 · TF4 · ảnh xem trước tĩnh (trang trí) của bảng hợp đồng ở showcase đăng nhập — port
// `reference/mgmt-app-contracts/web/src/pages/auth/LoginPage.tsx:159-214`. Dữ liệu mẫu giữ nguyên (so màn hình D-02).
import { useTranslation } from "react-i18next";

type Tone = "ok" | "soon" | "late" | "act";
const ROWS: [string, string, string, string, Tone][] = [
  ["HĐ-2026-014", "Mua bao bì", "Bao Bì Phương Nam", "91.500.000 đ", "ok"],
  ["HĐ-2026-011", "Chữ ký số · 12 CKS", "Viettel-CA", "21.600.000 đ", "soon"],
  ["HĐ-2025-098", "Thuê kho", "Kho Vận Miền Nam", "120.000.000 đ", "late"],
  ["HĐ-2026-016", "Gia công in", "In Ấn Thành Đạt", "34.200.000 đ", "act"],
  ["HĐ-2026-009", "Mua gia vị", "Gia Vị Việt", "58.000.000 đ", "ok"],
];
const PILL: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  soon: "bg-soon-bg text-soon",
  late: "bg-late-bg text-late",
  act: "bg-act-soft text-act",
};
const NAV = ["contracts", "partners", "prices", "products"] as const;
const TH = "border-b border-rule px-2.5 py-2.5 font-semibold";
const TD = "border-b border-rule-soft px-2.5 py-3";

export function AppPreview() {
  const { t } = useTranslation();
  return (
    <div className="mt-1 ml-auto flex h-[560px] w-[860px] shrink-0 overflow-hidden rounded-tl-2xl border border-r-0 border-b-0 border-rule bg-panel shadow-[0_24px_60px_rgba(30,27,75,0.18)]">
      <div className="flex w-[188px] shrink-0 flex-col gap-1 border-r border-rule bg-sunk p-4">
        <div className="mb-3 flex items-center gap-2 text-[13.5px] font-bold">
          <img src="/evolu-icon.svg" alt="" className="h-6 w-6" /> {t("contracts.app.name")}
        </div>
        {NAV.map((n, i) => (
          <span
            key={n}
            className={`rounded-lg px-3 py-2 text-[13px] ${i === 0 ? "bg-act-soft font-semibold text-act" : "text-ink-2"}`}
          >
            {t(`contracts.nav.${n}`)}
          </span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 p-5">
        <div className="flex items-center gap-3">
          <h3 className="text-[20px] font-bold">{t("contracts.nav.contracts")}</h3>
          <span className="ml-auto rounded-lg bg-act px-3 py-1.5 text-[12.5px] font-semibold text-on-act">
            {t("contracts.login.preview.add")}
          </span>
        </div>
        <div className="flex h-[34px] max-w-[280px] items-center rounded-full border border-field px-4 text-[13px] text-dim">
          {t("contracts.login.preview.search")}
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] tracking-wide text-dim uppercase">
              <th className={TH}>{t("contracts.login.preview.colContract")}</th>
              <th className={TH}>{t("contracts.login.preview.colSeller")}</th>
              <th className={`${TH} text-right`}>{t("contracts.login.preview.colValue")}</th>
              <th className={TH}>{t("contracts.login.preview.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([no, kind, seller, value, tone]) => (
              <tr key={no}>
                <td className={TD}>
                  <b>{no}</b>
                  <span className="block text-[12px] text-dim">{kind}</span>
                </td>
                <td className={TD}>{seller}</td>
                <td className={`${TD} text-right font-mono whitespace-nowrap`}>{value}</td>
                <td className={TD}>
                  <span
                    className={`inline-flex h-[22px] items-center rounded-full px-2.5 text-[11.5px] font-semibold ${PILL[tone]}`}
                  >
                    {t(`contracts.login.preview.${tone}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
