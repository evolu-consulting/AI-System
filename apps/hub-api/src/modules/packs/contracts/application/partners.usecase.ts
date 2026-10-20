// HD8-FR-01…06 · HD8-NFR-01 · port `mgmt-app/api/app/routes/{scoring,prices}.py` + `scoring/service.py`: đối tác, điểm uy tín
// (tính khi đọc, không lưu sẵn), cấu hình + xem trước + lịch sử, chấm tay, so giá hàng hoá + báo giá. Mỗi yêu cầu đọc: MỘT tx người
// dùng; đọc = ba câu song song cố định (D8-18), không theo số hàng. Luật thấy M1 (review HD78 #9 — sửa chú thích cũ sai): sổ đối
// tác có policy RESTRICTIVE `partner_events_visible` (M1b: đối tác mình thấy, HĐ mình thấy, hoặc do mình ghi) ⇒ điểm tính trên phần sổ
// người dùng thấy; danh bạ / báo giá / ảnh chụp điểm theo `visible_party_keys()` hoặc do mình tạo (0019); owner/chế độ tenant thấy hết.
// Không dùng phạm vi hệ thống trong HTTP.
import type { QuoteCreate, RatingRequest, ScoringDraft } from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { PartnerData, PartnersRepo, StoredConfig } from "../adapters/partners.repo";
import type { PartnerParts, WindowOverride } from "../adapters/partners-data.repo";
import { compareGoods, priceGaps, priceLines, productList } from "../domain/goods-prices.rules";
import type { Inspect } from "../domain/link-check.rules";
import { localDate } from "../domain/local-time.rules";
import {
  type Cfg,
  factsOf,
  onePerParty,
  type PartnerOut,
  partnersOf,
  previewOf,
  ratingsOf,
} from "../domain/partners.rules";
import {
  defaultConfig,
  MANUAL_CHOICES,
  normalise,
  problem,
  type Role,
  restorable,
  summary,
} from "../domain/scoring-config.rules";
import { normalizeTaxId } from "../domain/warnings.rules";

export class PartnersFail extends Error {
  constructor(
    readonly kind: "not_found" | "invalid" | "forbidden",
    readonly detail = "",
  ) {
    super(kind);
  }
}

type Repos = { partners: PartnersRepo };
export type PartnersDeps = {
  uow: PackUow<Repos>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
  /** Ghép ba phần đọc song song ⇒ dữ liệu chấm điểm (adapter `partnerDataOf`). */
  combine: (parts: PartnerParts) => PartnerData;
  /** Mở link giá kiểm con số (`link_check.inspect`); test thay bằng trang giả. */
  inspect: Inspect;
};

const ROLES: Role[] = ["customer", "supplier"];
const cfgOf = (stored: StoredConfig | undefined, role: Role) =>
  stored
    ? { ...stored, criteria: normalise(stored.criteria) }
    : (defaultConfig(role) as StoredConfig);

/** Bản nháp ⇒ cấu hình chuẩn hoá; sai ⇒ 422 với đúng câu của mgmt (`_draft`). */
function draftOf(role: Role, b: ScoringDraft): Cfg {
  const criteria = normalise(b.criteria);
  const msg = problem(role, criteria, b.rules);
  if (msg) throw new PartnersFail("invalid", msg);
  return { criteria, rules: b.rules };
}

const strip = ({ breakdown: _b, ...p }: PartnerOut) => p;

export function partnersUsecase(d: PartnersDeps) {
  const today = async (who: PackWho) => localDate(d.now(), await d.timeZoneOf(who.tenantId));

  /**
   * Mọi thứ cần để chấm (sổ đã gom ở SQL) + tập người dùng thấy. `ov`: khoảng tính của bản nháp (xem trước/lưu); `roles`: vai cần
   * điểm (Luật 4c: sổ của vai khác không đọc — so giá chỉ NCC, danh sách mặt hàng không cần điểm).
   */
  async function load(who: PackWho, ov?: WindowOverride, roles: readonly Role[] = ROLES) {
    const day = await today(who);
    // Ba câu độc lập ở ba tx chỉ đọc song song (độ trễ = câu chậm nhất, HD8-NFR-01); giá đang áp dụng tính ngay khi câu giá xong,
    // chồng lên lúc còn chờ câu sổ.
    const [ledger, facts0, [prices, lines]] = await Promise.all([
      d.uow.tenant(who, (r) => r.partners.ledger(day, ov, roles)),
      d.uow.tenant(who, (r) => r.partners.facts(day)),
      d.uow
        .tenant(who, (r) => r.partners.prices())
        .then((p) => [p, priceLines(p.contracts, day)] as const),
    ]);
    const data: PartnerData = d.combine([ledger, facts0, prices]);
    const facts = factsOf(data.facts, priceGaps(lines, data.quotes));
    // M1 `view.company`: đối tác có HĐ đã duyệt người dùng thấy (data() đã chạy dưới RLS của người dùng).
    const vis = { parties: new Set([...facts.values()].map((f) => f.party)) };
    const stored = new Map(data.configs.map((c) => [c.role, c]));
    const cfgs = {
      customer: cfgOf(stored.get("customer"), "customer"),
      supplier: cfgOf(stored.get("supplier"), "supplier"),
    };
    const partners = (role: Role | null, over: Partial<Record<Role, Cfg>> = {}, all = false) =>
      partnersOf({
        facts,
        aggs: data.aggs,
        names: data.names,
        cfgs: { ...cfgs, ...over },
        today: day,
        role,
        visible: all ? () => true : (p) => vis.parties.has(p),
      });
    const seenLines = lines;
    return { day, data, vis, cfgs, partners, seenLines };
  }

  const list = async (who: PackWho, role: Role | "all") => {
    const l = await load(who, undefined, role === "all" ? ROLES : [role]);
    const rows = l.partners(role === "all" ? null : role);
    return (role === "all" ? onePerParty(rows) : rows).map(strip);
  };

  const one = async (who: PackWho, party: string, role: Role) => {
    const p = (await load(who, undefined, [role])).partners(role).find((x) => x.party === party);
    if (!p) throw new PartnersFail("not_found");
    return p;
  };

  const ratings = async (who: PackWho, party: string, role: Role) => {
    const l = await load(who);
    if (!l.vis.parties.has(party)) throw new PartnersFail("not_found");
    const evs = await d.uow.tenant(who, (r) => r.partners.ratingEvents(party, role));
    return ratingsOf(l.cfgs[role], evs, l.day);
  };

  const rate = async (who: PackWho, b: RatingRequest) => {
    const day = await today(who);
    return d.uow.tenant(who, async ({ partners: r }) => {
      const cfg = cfgOf((await r.lockConfig(b.role)) ?? undefined, b.role);
      const manual = cfg.criteria.filter((c) => c.kind === "manual").map((c) => c.key);
      if (!manual.includes(b.criterion))
        throw new PartnersFail("invalid", "Tiêu chí không có trong cách tính điểm");
      const e = await r.insertRating({ ...b, at: day, note: b.note?.trim() || null });
      if (!e) throw new PartnersFail("not_found");
      return e;
    });
  };

  const getConfig = async (who: PackWho, role: Role) => {
    const cfg = cfgOf((await d.uow.tenant(who, (r) => r.partners.config(role))) ?? undefined, role);
    return {
      ...cfg,
      restorable: restorable(role, cfg.criteria),
      manual_choices: MANUAL_CHOICES[role],
    };
  };

  const preview = async (who: PackWho, role: Role, b: ScoringDraft) => {
    const draft = draftOf(role, b);
    const l = await load(who, { [role]: draft.rules });
    return previewOf(l.partners(role), l.partners(role, { [role]: draft }));
  };

  /** `save_config`: chỉ quản lý (route kiểm `admin`); tăng version, lịch sử + ảnh chụp điểm mọi đối tác của vai (cả tenant). */
  const save = async (who: PackWho, role: Role, b: ScoringDraft) => {
    const draft = draftOf(role, b);
    const l = await load(who, { [role]: draft.rules });
    const snapshots = l
      .partners(role, { [role]: draft }, true)
      .map((p) => ({ party: p.party, score: p.score, band: p.band }));
    return d.uow.tenant(who, async ({ partners: r }) => {
      const before = cfgOf((await r.lockConfig(role)) ?? undefined, role);
      const version = before.version + 1;
      const saved = await r.saveConfig({
        role,
        version,
        by: who.userId,
        criteria: draft.criteria,
        rules: draft.rules,
        summary: summary(before, draft),
        before: { criteria: before.criteria, rules: before.rules },
        snapshots,
      });
      return {
        role,
        version: saved.version,
        criteria: draft.criteria,
        rules: draft.rules,
        updated_by: saved.updated_by,
        updated_at: saved.updated_at,
        restorable: restorable(role, draft.criteria),
        manual_choices: MANUAL_CHOICES[role],
      };
    });
  };

  const history = (who: PackWho, role: Role) => d.uow.tenant(who, (r) => r.partners.history(role));

  // ---- so giá hàng hoá ----
  const products = async (who: PackWho) => {
    const l = await load(who, undefined, []);
    return productList(l.seenLines, l.data.quotes);
  };

  const compare = async (who: PackWho, product: string) => {
    const l = await load(who, undefined, ["supplier"]);
    if (!productList(l.seenLines, l.data.quotes).some((p) => p.key === product))
      throw new PartnersFail("not_found");
    const scores = new Map(l.partners("supplier").map((p) => [p.party, p]));
    return compareGoods(l.seenLines, l.data.quotes, product, scores, l.data.market.get(product));
  };

  /** `add_quote`: mặt hàng phải so được; tên mặt hàng mặc định theo nhãn; có link ⇒ máy chủ mở kiểm con số (ngoài tx). */
  const addQuote = async (who: PackWho, b: QuoteCreate) => {
    const l = await load(who, undefined, []);
    const known = productList(l.seenLines, l.data.quotes).find((p) => p.key === b.product);
    if (!known) throw new PartnersFail("not_found");
    const name = b.product_name || (known.label.split(" · ").at(-1) ?? "").split(" (đ/")[0] || "";
    if (!name) throw new PartnersFail("invalid", "Cần tên mặt hàng");
    const check = b.url
      ? await d.inspect(b.url, b.price)
      : { verified: null, page_date: null, note: null };
    return d.uow.tenant(who, (r) =>
      r.partners.insertQuote({
        ...b,
        product_name: name,
        unit: b.unit || known.unit,
        tax: b.supplier_tax_id ? normalizeTaxId(b.supplier_tax_id) : null,
        check,
      }),
    );
  };

  /** `POST /prices/check-link`. */
  const checkLink = (url: string, price: number) => d.inspect(url, price);
  const deleteQuote = (who: PackWho, id: string) =>
    d.uow.tenant(who, async (r) => {
      if (!(await r.partners.deleteQuote(id))) throw new PartnersFail("not_found");
      return { ok: true };
    });

  return {
    list,
    one,
    ratings,
    rate,
    getConfig,
    preview,
    save,
    history,
    products,
    compare,
    addQuote,
    checkLink,
    deleteQuote,
    roles: ROLES,
  };
}
export type PartnersUsecase = ReturnType<typeof partnersUsecase>;
