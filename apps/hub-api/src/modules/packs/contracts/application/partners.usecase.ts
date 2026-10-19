// HD8-FR-01…06 · HD8-NFR-01 · port `mgmt-app/api/app/routes/{scoring,prices}.py` + `scoring/service.py`: đối tác, điểm uy tín
// (tính khi đọc, không lưu sẵn), cấu hình + xem trước + lịch sử, chấm tay, so giá hàng hoá + báo giá. Mỗi yêu cầu đọc: MỘT tx người
// dùng, MỘT câu (`data`) ⇒ số câu cố định, không theo số hàng. D8-04: sổ đối tác không có policy M1 ⇒ điểm trên CẢ sổ như
// mgmt; sự thật từ HĐ (số HĐ, gắn bó, chênh giá) chỉ từ HĐ người dùng thấy (owner thấy hết) — không dùng phạm vi hệ thống trong HTTP.
import type { QuoteCreate, RatingRequest, ScoringDraft } from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { PartnerData, PartnersRepo, StoredConfig } from "../adapters/partners.repo";
import { compareGoods, priceGaps, priceLines, productList } from "../domain/goods-prices.rules";
import { localDate } from "../domain/local-time.rules";
import {
  type Cfg,
  factsOf,
  groupEvents,
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

  /** Mọi thứ cần để chấm (cả tenant) + tập người dùng thấy. */
  async function load(who: PackWho) {
    const day = await today(who);
    const data: PartnerData = await d.uow.tenant(who, (r) => r.partners.data());
    const lines = priceLines(data.contracts, day);
    const facts = factsOf(data.facts, priceGaps(lines, data.quotes));
    // M1 `view.company`: đối tác có HĐ đã duyệt người dùng thấy (data() đã chạy dưới RLS của người dùng).
    const vis = { parties: new Set([...facts.values()].map((f) => f.party)) };
    const stored = new Map(data.configs.map((c) => [c.role, c]));
    const cfgs = {
      customer: cfgOf(stored.get("customer"), "customer"),
      supplier: cfgOf(stored.get("supplier"), "supplier"),
    };
    const events = groupEvents(data.events);
    const partners = (role: Role | null, over: Partial<Record<Role, Cfg>> = {}, all = false) =>
      partnersOf({
        facts,
        events,
        cfgs: { ...cfgs, ...over },
        today: day,
        role,
        visible: all ? () => true : (p) => vis.parties.has(p),
      });
    const seenLines = lines;
    return { day, data, vis, cfgs, events, partners, seenLines };
  }

  const list = async (who: PackWho, role: Role | "all") => {
    const l = await load(who);
    const rows = l.partners(role === "all" ? null : role);
    return (role === "all" ? onePerParty(rows) : rows).map(strip);
  };

  const one = async (who: PackWho, party: string, role: Role) => {
    const p = (await load(who)).partners(role).find((x) => x.party === party);
    if (!p) throw new PartnersFail("not_found");
    return p;
  };

  const ratings = async (who: PackWho, party: string, role: Role) => {
    const l = await load(who);
    if (!l.vis.parties.has(party)) throw new PartnersFail("not_found");
    return ratingsOf(l.cfgs[role], l.events.get(`${role}|${party}`) ?? [], l.day);
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
    const l = await load(who);
    return previewOf(l.partners(role), l.partners(role, { [role]: draft }));
  };

  /** `save_config`: chỉ quản lý (route kiểm `admin`); tăng version, lịch sử + ảnh chụp điểm mọi đối tác của vai (cả tenant). */
  const save = async (who: PackWho, role: Role, b: ScoringDraft) => {
    const draft = draftOf(role, b);
    const l = await load(who);
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
    const l = await load(who);
    return productList(l.seenLines, l.data.quotes);
  };

  const compare = async (who: PackWho, product: string) => {
    const l = await load(who);
    if (!productList(l.seenLines, l.data.quotes).some((p) => p.key === product))
      throw new PartnersFail("not_found");
    const scores = new Map(l.partners("supplier").map((p) => [p.party, p]));
    return compareGoods(l.seenLines, l.data.quotes, product, scores);
  };

  const addQuote = async (who: PackWho, b: QuoteCreate) => {
    const l = await load(who);
    const known = productList(l.seenLines, l.data.quotes).find((p) => p.key === b.product);
    if (!known) throw new PartnersFail("not_found");
    const name = b.product_name || (known.label.split(" · ").at(-1) ?? "").split(" (đ/")[0] || "";
    if (!name) throw new PartnersFail("invalid", "Cần tên mặt hàng");
    return d.uow.tenant(who, (r) =>
      r.partners.insertQuote({ ...b, product_name: name, unit: b.unit || known.unit }),
    );
  };

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
    deleteQuote,
    roles: ROLES,
  };
}
export type PartnersUsecase = ReturnType<typeof partnersUsecase>;
