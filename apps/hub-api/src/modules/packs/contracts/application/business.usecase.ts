// V2-J1 · SP-01/02/07 · KN-15 · CD-06: điểm kinh doanh của SP — danh sách (một câu gom theo tập), chi tiết (tóm tắt + lịch sử mua bán), HĐ theo SP,
// cấu hình. Điểm tính khi đọc (đổi cấu hình ⇒ đổi ngay), không lưu. Ngày = ngày lịch tenant.

import type { PackUow, PackWho } from "../../kit/application/ports";
import type {
  BizConfig,
  BizConfigOut,
  BizContractOut,
  BizDetailOut,
  BizListOut,
  BizListQuery,
  BizPreviewIn,
  BizProductRow,
  BizScore,
} from "../domain/business.types";
import { bizProblem, DEFAULT_BIZ, mergeBiz, scoreBusiness } from "../domain/business-score.rules";
import { localDate } from "../domain/local-time.rules";
import type { BizRow, BusinessRepo } from "./business.ports";

export class BizFail extends Error {
  constructor(
    readonly kind: "not_found" | "invalid",
    readonly detail = "",
  ) {
    super(kind);
  }
}

export type BizDeps = {
  uow: PackUow<{ business: BusinessRepo }>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
};

const rowOut = (r: BizRow, cfg: BizConfig): BizProductRow => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  group: r.input.group,
  kind: r.input.kind,
  held: { qty: r.input.heldQty, unit: r.unit, expires_on: r.expiresOn, value: r.value },
  sold_12m: r.input.sold12,
  sold_3m: r.input.l3,
  business: scoreBusiness(r.input, cfg),
});

/** "Thử tính" (CD-06): số mẫu một SP theo cấu hình đang chỉnh — hàm thuần, không đọc/ghi DB. */
function previewBiz(b: BizPreviewIn): BizScore {
  const msg = bizProblem(b.config);
  if (msg) throw new BizFail("invalid", msg);
  const s = b.sample;
  return scoreBusiness(
    {
      group: s.kind === "quota" ? "service" : s.kind === "referral" ? "referral" : "goods",
      kind: s.kind,
      heldQty: s.held,
      unit: null,
      expiresInDays: s.kind === "quota" ? s.dte : null,
      sold12: s.l3 + s.p3,
      l3: s.l3,
      p3: s.p3,
      revenue: s.price * s.l3,
      cost: s.cost * s.l3,
      commissionTotal: 0,
      commissionReceived: 0,
    },
    b.config,
  );
}

const configOut = (s: Awaited<ReturnType<BusinessRepo["config"]>>): BizConfigOut => ({
  config: mergeBiz(s?.config),
  defaults: DEFAULT_BIZ,
  version: s?.version ?? 0,
  updated_at: s?.updated_at ?? null,
});

function bizCtx(d: BizDeps) {
  const tx = <T>(who: PackWho, fn: (r: BusinessRepo) => Promise<T>) =>
    d.uow.tenant(who, (r) => fn(r.business));
  const today = async (who: PackWho) => localDate(d.now(), await d.timeZoneOf(who.tenantId));
  const cfgOf = async (who: PackWho) => configOut(await tx(who, (r) => r.config())).config;
  return { tx, today, cfgOf };
}

export function businessUsecase(d: BizDeps) {
  const { tx, today, cfgOf } = bizCtx(d);
  return {
    getConfig: async (who: PackWho): Promise<BizConfigOut> =>
      configOut(await tx(who, (r) => r.config())),
    async saveConfig(who: PackWho, cfg: BizConfig): Promise<BizConfigOut> {
      const msg = bizProblem(cfg);
      if (msg) throw new BizFail("invalid", msg);
      return configOut(await tx(who, (r) => r.saveConfig(cfg)));
    },
    preview: previewBiz,
    /** Cấu hình rồi MỘT câu gom cho cả danh sách: số câu cố định theo số SP. */
    async list(who: PackWho, q: BizListQuery): Promise<BizListOut> {
      const [day, cfg] = await Promise.all([today(who), cfgOf(who)]);
      const rows = await tx(who, (r) =>
        r.rows(day, { ...(q.group ? { group: q.group } : {}), ...(q.q ? { q: q.q } : {}) }),
      );
      const items = rows.map((r) => rowOut(r, cfg));
      const counts = { all: items.length, service: 0, goods: 0, referral: 0 };
      for (const i of items) counts[i.group]++;
      return { items, counts };
    },
    async detail(who: PackWho, id: string): Promise<BizDetailOut> {
      const [day, cfg] = await Promise.all([today(who), cfgOf(who)]);
      const [rows, extras] = await tx(
        who,
        async (r) => [await r.rows(day, { id }), await r.extras(id, day)] as const,
      );
      const row = rows[0];
      if (!row) throw new BizFail("not_found");
      const { revenue, cost } = row.input;
      return {
        product: rowOut(row, cfg),
        revenue_12m: row.revenueAll,
        margin_pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
        ...extras,
      };
    },
    async contracts(who: PackWho, id: string): Promise<BizContractOut[]> {
      const out = await tx(who, async (r) =>
        (await r.exists(id)) ? await r.contractsOf(id) : null,
      );
      if (!out) throw new BizFail("not_found");
      return out;
    },
  };
}
export type BusinessUsecase = ReturnType<typeof businessUsecase>;
