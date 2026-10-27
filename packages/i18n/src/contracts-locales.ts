// PK-FR-10 · TF1: chuỗi riêng của contracts-web (`contracts.*`), nạp động từng ngôn ngữ (không kéo chuỗi Admin/chat vào bundle).
// HD9: chuỗi CKS ở tệp riêng (`contracts.cks.*`); M2-chat: trợ lý (`contracts.assistant.*`); M1D: cơ cấu (`contracts.org.*`);
// HD7: sổ đối tác (`contracts.ledger.*`); HD8: đối tác, điểm uy tín, giá hàng hoá (`contracts.partners.*`, `contracts.scoring.*`,
// `contracts.goods.*`) — gộp vào cùng gốc `contracts`; V2-F: form + chi tiết hợp đồng (`contracts.cform.*`, `contracts.cdetail.*`).
import type { Locale } from "./locales";

type Part = { default: { contracts: Record<string, unknown> } };
/** Các tệp chuỗi theo thứ tự gộp: gốc, cks, assistant, org, work, ledger, partners, v2f, v2g, v2h, v2i, v2j2, v2l, v2m, v2gaps, gapa1, gape, k3b, g2, esign, legal, docframe, rep3 (rep3 luôn CUỐI: gộp sâu). */
type Parts = readonly [
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
  Part,
];

const loadEn = (): Promise<Parts> =>
  Promise.all([
    import("../locales/contracts/en.json"),
    import("../locales/contracts/cks.en.json"),
    import("../locales/contracts/assistant.en.json"),
    import("../locales/contracts/org.en.json"),
    import("../locales/contracts/work.en.json"),
    import("../locales/contracts/ledger.en.json"),
    import("../locales/contracts/partners.en.json"),
    import("../locales/contracts/v2f.en.json"),
    import("../locales/contracts/v2g.en.json"),
    import("../locales/contracts/v2h.en.json"),
    import("../locales/contracts/v2i.en.json"),
    import("../locales/contracts/v2j2.en.json"),
    import("../locales/contracts/v2l.en.json"),
    import("../locales/contracts/v2m.en.json"),
    import("../locales/contracts/v2gaps.en.json"),
    import("../locales/contracts/gapa1.en.json"),
    import("../locales/contracts/gape.en.json"),
    import("../locales/contracts/k3b.en.json"),
    import("../locales/contracts/g2.en.json"),
    import("../locales/contracts/esign.en.json"),
    import("../locales/contracts/legal.en.json"),
    import("../locales/contracts/docframe.en.json"),
    import("../locales/contracts/rep3.en.json"),
  ]);

const loadVi = (): Promise<Parts> =>
  Promise.all([
    import("../locales/contracts/vi.json"),
    import("../locales/contracts/cks.vi.json"),
    import("../locales/contracts/assistant.vi.json"),
    import("../locales/contracts/org.vi.json"),
    import("../locales/contracts/work.vi.json"),
    import("../locales/contracts/ledger.vi.json"),
    import("../locales/contracts/partners.vi.json"),
    import("../locales/contracts/v2f.vi.json"),
    import("../locales/contracts/v2g.vi.json"),
    import("../locales/contracts/v2h.vi.json"),
    import("../locales/contracts/v2i.vi.json"),
    import("../locales/contracts/v2j2.vi.json"),
    import("../locales/contracts/v2l.vi.json"),
    import("../locales/contracts/v2m.vi.json"),
    import("../locales/contracts/v2gaps.vi.json"),
    import("../locales/contracts/gapa1.vi.json"),
    import("../locales/contracts/gape.vi.json"),
    import("../locales/contracts/k3b.vi.json"),
    import("../locales/contracts/g2.vi.json"),
    import("../locales/contracts/esign.vi.json"),
    import("../locales/contracts/legal.vi.json"),
    import("../locales/contracts/docframe.vi.json"),
    import("../locales/contracts/rep3.vi.json"),
  ]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const deepMerge = (a: unknown, b: unknown): unknown =>
  isObj(a) && isObj(b)
    ? Object.fromEntries(
        [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [
          k,
          k in b ? deepMerge(a[k], b[k]) : a[k],
        ]),
      )
    : b;

function merge([mod, cks, assistant, org, work, ledger, partners, v2f, v2g, ...tail]: Parts) {
  // REP-v3-ui: phần cuối (`rep3`) gộp SÂU vào các nhánh đã có (`pv2`, `settings`…) thay vì ghi đè cả nhánh.
  const rep3 = tail[tail.length - 1] as Part;
  const rest = tail.slice(0, -1);
  const base = mod.default as { contracts: Record<string, unknown> };
  const later = rest.map((p) => p.default.contracts); // V2-H svc, V2-I pv2, V2-J2 psup, V2-L settings, V2-M, V2-GAPS, GAP-E
  const f = v2f.default.contracts as { cform: object; cdetail: object };
  const g = v2g.default.contracts as { cform: object; cdetail: object };
  const merged = {
    ...base,
    contracts: {
      ...base.contracts,
      ...cks.default.contracts,
      ...assistant.default.contracts,
      ...org.default.contracts,
      ...work.default.contracts,
      ...ledger.default.contracts,
      ...partners.default.contracts,
      ...f,
      ...Object.assign({}, ...later),
      // V2-G: thêm khoá vào cform/cdetail của V2-F (gộp một cấp, không ghi đè).
      cform: { ...f.cform, ...g.cform },
      cdetail: { ...f.cdetail, ...g.cdetail },
    },
  };
  return { ...merged, contracts: deepMerge(merged.contracts, rep3.default.contracts) };
}

/** Nạp bản dịch contracts-web của một ngôn ngữ khi cần (mỗi ngôn ngữ một chunk riêng). */
export async function loadContractsLocale(locale: Locale): Promise<Record<string, unknown>> {
  return merge(await (locale === "en" ? loadEn() : loadVi()));
}
