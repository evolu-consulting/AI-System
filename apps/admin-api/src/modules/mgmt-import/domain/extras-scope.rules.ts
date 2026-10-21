// niti-import2 Â· pháº§n "cÃ²n láº¡i" cá»§a Má»˜T tÃ i khoáº£n mgmt-app (ngoÃ i HÄ/sá»•): chat + file chat, vÄƒn báº£n kÃ½ + chá»©ng thÆ° CKS, thÃ´ng bÃ¡o,
// bÃ¡o giÃ¡, lÆ°á»£t quÃ©t giÃ¡ (+ káº¿t quáº£ `market_observations` cá»§a lÆ°á»£t Ä‘Ã³), lá»‹ch sá»­ cáº¥u hÃ¬nh cháº¥m Ä‘iá»ƒm. (a) `extrasFor`: lÃºc export
// gom má»i báº£n ghi cá»§a ngÆ°á»i Ä‘Ã³ (má»i org) + cÃ´ng ty Ä‘Æ°á»£c tham chiáº¿u; thÃ´ng bÃ¡o khÃ´ng cÃ³ org â‡’ gáº¯n `_contract_org` (org cá»§a HÄ nÃ³ trá»).
// (b) `keepExtras`: lÃºc nháº­p CHá»ˆ giá»¯ báº£n ghi thuá»™c org Ä‘Ã­ch (ngÆ°á»i dÃ¹ng chá»‘t 2026-10-21: báº£n ghi á»Ÿ org khÃ¡c = dá»¯ liá»‡u thá»­ â‡’
// `excluded_other_org`) vÃ  bá» báº£n ghi mang dáº¥u "[E2E]" (`excluded_e2e`). GÃ³p Ã½ (`feedback`) KHÃ”NG nháº­p (toÃ n dá»¯ liá»‡u thá»­). Thuáº§n.
import { docsOf, type Snapshot, type SourceDoc } from "./context";
import { lowerEmail, str } from "./values.rules";

/** Index pháº§n cÃ²n láº¡i Ä‘Æ°á»£c nháº­p (thá»© tá»± = thá»© tá»± bÃ¡o cÃ¡o). */
export const EXTRA_INDICES = [
  "chats",
  "chat_files",
  "signed_docs",
  "cks_certificates",
  "notifications",
  "quotes",
  "market_scans",
  "score_config_history",
] as const;
export type ExtraIndex = (typeof EXTRA_INDICES)[number];
/** Index phá»¥ Ä‘i kÃ¨m (khÃ´ng tá»± Ä‘áº¿m lÃ  "cá»§a" ngÆ°á»i Ä‘Ã³): káº¿t quáº£ quÃ©t, danh báº¡ cÃ´ng ty Ä‘Æ°á»£c tham chiáº¿u. */
const SIDE = ["market_observations", "companies"] as const;

/** TrÆ°á»ng ngÆ°á»i cá»§a tá»«ng index (email chá»§ báº£n ghi). */
const PERSON: Record<ExtraIndex, string[]> = {
  chats: ["user_email"],
  chat_files: ["by"],
  signed_docs: ["by"],
  cks_certificates: ["created_by"],
  notifications: ["user_email"],
  quotes: ["by"],
  market_scans: ["by"],
  score_config_history: ["by"],
};

export type ExtrasDocs = Partial<Record<ExtraIndex | (typeof SIDE)[number], SourceDoc[]>>;

const mineDoc = (ix: ExtraIndex, d: SourceDoc, email: string, contracts: Set<string>) =>
  PERSON[ix].some((k) => lowerEmail(d.src[k]) === email) ||
  (ix === "cks_certificates" && contracts.has(String(d.src.sale_contract_id ?? "")));

/** Export: báº£n ghi pháº§n cÃ²n láº¡i cá»§a `email` (má»i org) + káº¿t quáº£ quÃ©t + cÃ´ng ty Ä‘Æ°á»£c trá» tá»›i. */
export function extrasFor(s: Snapshot, email: string, contracts: Set<string>): ExtrasDocs {
  const out: ExtrasDocs = {};
  const orgOf = new Map(docsOf(s, "contracts").map((d) => [d.id, str(d.src.org_id, 128)]));
  for (const ix of EXTRA_INDICES) {
    const docs = docsOf(s, ix).filter((d) => mineDoc(ix, d, email, contracts));
    out[ix] =
      ix === "notifications"
        ? docs.map((d) => ({
            id: d.id,
            src: {
              ...d.src,
              _contract_org:
                orgOf.get(String(d.src.contract_id ?? "")) ?? d.src._contract_org ?? null,
            },
          }))
        : docs;
  }
  const scans = new Set((out.market_scans ?? []).map((d) => d.id));
  out.market_observations = docsOf(s, "market_observations").filter((d) =>
    scans.has(String(d.src.scan_id ?? "")),
  );
  const companyIds = new Set<string>();
  for (const d of [...(out.signed_docs ?? []), ...(out.cks_certificates ?? [])])
    if (str(d.src.company_id, 300)) companyIds.add(String(d.src.company_id));
  for (const d of out.quotes ?? [])
    if (str(d.src.supplier_company_id, 300)) companyIds.add(String(d.src.supplier_company_id));
  out.companies = docsOf(s, "companies").filter((d) => companyIds.has(d.id));
  return out;
}

/** Org cá»§a báº£n ghi (thÃ´ng bÃ¡o: org cá»§a HÄ nÃ³ trá», ghi lÃºc export). */
export const orgOfDoc = (d: SourceDoc): string | null =>
  str(d.src.org_id, 128) ?? str(d.src._contract_org, 128);

/** Báº£n ghi mang dáº¥u kiá»ƒm thá»­ "[E2E]" á»Ÿ báº¥t ká»³ trÆ°á»ng chá»¯ nÃ o. */
export const isE2e = (d: SourceDoc): boolean => JSON.stringify(d.src).includes("[E2E]");

export type KeptExtras = {
  docs: ExtrasDocs;
  /** Theo index: sá»‘ báº£n ghi cá»§a ngÆ°á»i Ä‘Ã³ trong export (trÆ°á»›c lá»c), bá»‹ loáº¡i do org khÃ¡c, do dáº¥u [E2E]. */
  source_all: Record<string, number>;
  excluded_other_org: Record<string, number>;
  excluded_e2e: Record<string, number>;
};

/** Nháº­p: chá»‰ giá»¯ báº£n ghi thuá»™c `org` vÃ  khÃ´ng mang dáº¥u [E2E]; káº¿t quáº£ quÃ©t chá»‰ theo lÆ°á»£t quÃ©t Ä‘Æ°á»£c giá»¯. */
export function keepExtras(all: ExtrasDocs, org: string): KeptExtras {
  const r: KeptExtras = { docs: {}, source_all: {}, excluded_other_org: {}, excluded_e2e: {} };
  for (const ix of EXTRA_INDICES) {
    const docs = all[ix] ?? [];
    const inOrg = docs.filter((d) => orgOfDoc(d) === org);
    const kept = inOrg.filter((d) => !isE2e(d));
    r.source_all[ix] = docs.length;
    r.excluded_other_org[ix] = docs.length - inOrg.length;
    r.excluded_e2e[ix] = inOrg.length - kept.length;
    r.docs[ix] = kept;
  }
  const scans = new Set((r.docs.market_scans ?? []).map((d) => d.id));
  r.docs.market_observations = (all.market_observations ?? []).filter(
    (d) => scans.has(String(d.src.scan_id ?? "")) && !isE2e(d),
  );
  r.docs.companies = all.companies ?? [];
  return r;
}

/** Index cá»§a export coi lÃ  "Ä‘Ã£ cÃ³ chá»— nháº­p" (khÃ´ng Ä‘áº¿m vÃ o `not_imported`). */
export const EXTRA_EXPORT_INDICES: readonly string[] = [...EXTRA_INDICES, "market_observations"];
