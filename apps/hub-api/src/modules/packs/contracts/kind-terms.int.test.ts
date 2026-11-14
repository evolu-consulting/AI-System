// CR-152 · int (DB thật): Nhượng quyền / Thỏa thuận hợp tác — API trường riêng + kỳ, bộ mốc sinh khi DONE, ghi doanh thu kỳ ⇒ phí đúng,
// «không chia» không vào doanh thu/business. Quyền: owner (người được giao, KHÔNG phải người tạo) ghi được; editor (người tạo, chỉ đọc) 403;
// đối tác ngoài 403; tenant khác 404 (N2 + chéo tenant).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql as dsql } from "drizzle-orm";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../kit/adapters/pack-uow";
import { contractStateRepo, registerContractDoneHook } from "./adapters/contract-state.repo";
import { countsMoneySql } from "./adapters/kind-filter.sql";
import { kindScheduleDoneHook } from "./adapters/kind-schedule.hook";
import { kindTermsModule } from "./kind-terms.mount";

let o: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
const F = ["c-r", "c-w"];
const KEYS = ["contracts-read", "contracts-write"];

/** Owner (A, hA): đọc + ghi. Editor (A, hM): chỉ đọc. Nhóm gB: tenant B. s1a (đối tác ngoài): không nhóm nào. */
const view = (): PackAccessView => ({
  catalog: async () => ({
    features: F.map((id, i) => ({ id, key: KEYS[i] as string, status: "on" as const })),
    entitled: new Set(F.flatMap((f) => [`${c.A}:${f}`, `${c.B}:${f}`])),
    grantGroups: new Map(
      F.flatMap((f, i) => [
        [`${c.A}:${f}`, i === 0 ? [c.roles.owner, c.roles.editor] : [c.roles.owner]],
        [`${c.B}:${f}`, ["gB"]],
      ]),
    ),
  }),
  user: async (id) =>
    id === c.hB
      ? { tenantId: c.B, groupIds: new Set(["gB"]) }
      : {
          tenantId: c.A,
          groupIds: new Set(id === c.hA ? [c.roles.owner] : id === c.hM ? [c.roles.editor] : []),
        },
});

type Who = "hA" | "hM" | "hB" | "s1a";
const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: {
      "x-who": who,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  // biome-ignore lint/suspicious/noExplicitAny: JSON tự do trong test
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
};

const fld = (v: string) => ({ value: v, quote: "", verified: true, edited: true });
/** HĐ nháp do hM tạo, giao cho hA (người được giao ≠ người tạo). */
async function draft(deal: string, dir: string, start: string, end: string): Promise<string> {
  const [r] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: c.A,
    title: `HĐ thử CR-152 ${deal}`,
    created_by: c.hM,
    owner_user_id: c.hA,
    status: "draft",
    kind: "contract",
    doc_type: "contract",
    deal,
    direction: dir,
    fields: o.json({
      start_date: fld(start),
      end_date: fld(end),
      buyer_name: fld("Công ty Mẫu Đối Tác"),
      supplier_name: fld("Công ty Mẫu Đối Tác"),
    } as never),
  } as never)} returning id`;
  return (r as { id: string }).id;
}
const FR = {
  role: "franchisor",
  brand: "Cà Phê Mẫu",
  initial_fee: 300_000_000,
  fee_basis: "revenue_pct",
  fee_pct: 5,
  period: "month",
  ad_fee_pct: 1,
};
const uow = () => createPackUow(db, "contracts", (tx, t) => ({ st: contractStateRepo(tx, t), tx }));
const toDone = (id: string) =>
  uow().tenant({ tenantId: c.A, userId: c.hA }, async (r) =>
    r.st.applyTransition({ contractId: id, ev: "submit", actorId: c.hA, ctx: { hasFlow: false } }),
  );
const obl = (id: string) =>
  o<
    {
      kind: string;
      direction: string;
      owner: string;
      period_key: string | null;
      amount: string | null;
      title: string;
      status: string;
    }[]
  >`select kind, direction, owner, period_key, amount, title, status from contracts.obligations
    where contract_id = ${id} and status <> 'replaced' order by seq`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  c = await seedCast(o, 152);
  db = createDb(urls().hubApi, { max: 3 });
  registerContractDoneHook(kindScheduleDoneHook, "mốc-loại-HĐ");
  const v = view();
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    ctx.set("user", {
      userId: c[who],
      tenantId: who === "hB" ? c.B : c.A,
      role: who === "hA" ? "tenant_admin" : "member",
      ...(who === "s1a" ? { userKind: "external", extOrgId: c.S1 } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route("/p", kindTermsModule(db, v));
  h.onError((e, ctx) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return ctx.json(m.body, m.status);
  });
  app = h;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-152 · quyền + RLS của kind-terms", () => {
  it("N2: người được giao ghi được, người tạo (chỉ đọc) đọc được nhưng ghi 403, đối tác ngoài 403, tenant khác 404", async () => {
    const id = await draft("franchise", "sale", "2026-12-01", "2027-02-28");
    const base = `/p/contracts/${id}/kind-terms`;
    expect((await call("hA", "GET", base)).json.missing).toContain("brand");
    expect((await call("hM", "GET", base)).status).toBe(200);
    expect((await call("hM", "PUT", base, { terms: FR })).status).toBe(403);
    expect((await call("s1a", "PUT", base, { terms: FR })).status).toBe(403);
    expect((await call("hB", "GET", base)).status).toBe(404);
    expect((await call("hB", "PUT", base, { terms: FR })).status).toBe(404);
    const ok = await call("hA", "PUT", base, { terms: FR });
    expect(ok.status).toBe(200);
    expect(ok.json.missing).toEqual([]);
    const [{ direction } = { direction: "" }] = await o<
      { direction: string }[]
    >`select direction from contracts.contracts where id = ${id}`;
    expect(direction).toBe("sale");
    const back = await call("hA", "PUT", base, {
      terms: { role: "franchisee", moit_registered: true },
    });
    expect(back.json.terms.role).toBe("franchisee");
    const [{ d2 } = { d2: "" }] = await o<
      { d2: string }[]
    >`select direction as d2 from contracts.contracts where id = ${id}`;
    expect(d2).toBe("purchase");
  });

  it("khoá lạ ⇒ 400, HĐ Bán thường ⇒ 422 KIND_TERMS_NOT_APPLICABLE, HĐ đã DONE ⇒ 409 KIND_TERMS_LOCKED", async () => {
    const id = await draft("franchise", "sale", "2026-12-01", "2027-02-28");
    const base = `/p/contracts/${id}/kind-terms`;
    expect((await call("hA", "PUT", base, { terms: { lạ: 1 } })).status).toBe(400);
    expect((await call("hA", "PUT", base, { terms: { fee_pct: 120 } })).status).toBe(400);
    const sell = await draft("sell", "sale", "2026-12-01", "2027-02-28");
    const r = await call("hA", "GET", `/p/contracts/${sell}/kind-terms`);
    expect(r.status).toBe(422);
    await call("hA", "PUT", base, { terms: FR });
    expect((await toDone(id)).ok).toBe(true);
    const locked = await call("hA", "PUT", base, { terms: { brand: "Khác" } });
    expect(locked.status).toBe(409);
  });
});

describe("CR-152 · bộ mốc khi DONE + ghi doanh thu kỳ", () => {
  it("Nhượng quyền theo %, hằng tháng: 8 mốc đúng loại/hướng, không đợt HD7 thừa, hook chạy lại không đôi", async () => {
    const id = await draft("franchise", "sale", "2026-12-01", "2027-02-28");
    await call("hA", "PUT", `/p/contracts/${id}/kind-terms`, { terms: FR });
    expect((await toDone(id)).ok).toBe(true);
    const rows = await obl(id);
    expect(rows.map((r) => r.kind)).toEqual([
      "payment",
      "other",
      "payment",
      "other",
      "payment",
      "other",
      "payment",
      "renewal",
    ]);
    expect(rows[0]).toMatchObject({ direction: "receive", owner: "partner", amount: "300000000" });
    expect(rows[1]).toMatchObject({
      period_key: "2026-12",
      title: "Báo cáo doanh thu tháng 12/2026",
    });
    expect(rows[2]).toMatchObject({ period_key: "2026-12", amount: null });
    await uow().tenant({ tenantId: c.A, userId: c.hA }, (r) =>
      kindScheduleDoneHook.onDone(r.tx, c.A, id),
    );
    expect((await obl(id)).length).toBe(8);
  });

  it("ghi doanh thu kỳ ⇒ mốc báo cáo xong + phí kỳ đúng (5% + 1% quảng cáo), mốc phí đã xác nhận ⇒ 409, kỳ lạ ⇒ 404", async () => {
    const id = await draft("franchise", "sale", "2026-12-01", "2027-02-28");
    await call("hA", "PUT", `/p/contracts/${id}/kind-terms`, { terms: FR });
    await toDone(id);
    const put = `/p/contracts/${id}/periods/2026-12`;
    expect((await call("hM", "PUT", put, { figure: 820_000_000 })).status).toBe(403);
    expect((await call("hB", "PUT", put, { figure: 820_000_000 })).status).toBe(404);
    expect(
      (await call("hA", "PUT", `/p/contracts/${id}/periods/2030-01`, { figure: 1 })).status,
    ).toBe(404);
    const ok = await call("hA", "PUT", put, { figure: 820_000_000 });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      key: "2026-12",
      figure: 820_000_000,
      report: { status: "done" },
      fee: { amount: 49_200_000 },
    });
    const view = await call("hA", "GET", `/p/contracts/${id}/kind-terms`);
    expect(view.json.periods).toHaveLength(3);
    // sửa số kỳ khi mốc phí còn mở ⇒ tính lại
    const again = await call("hA", "PUT", put, { figure: 1_000_000_000 });
    expect(again.json.fee.amount).toBe(60_000_000);
    await o`update contracts.obligations set status = 'done', done_at = current_date
      where contract_id = ${id} and period_key = '2026-12' and kind = 'payment'`;
    expect((await call("hA", "PUT", put, { figure: 5 })).status).toBe(409);
  });

  it("phí cố định theo quý không quảng cáo: không mốc báo cáo ⇒ ghi kỳ 422, số tiền có sẵn", async () => {
    const id = await draft("franchise", "purchase", "2027-01-01", "2027-06-30");
    await call("hA", "PUT", `/p/contracts/${id}/kind-terms`, {
      terms: {
        role: "franchisee",
        brand: "X",
        fee_basis: "fixed",
        fee_fixed: 20_000_000,
        period: "quarter",
      },
    });
    await toDone(id);
    const rows = await obl(id);
    expect(rows.map((r) => r.kind)).toEqual(["payment", "payment", "renewal"]);
    expect(rows[0]).toMatchObject({
      direction: "pay",
      owner: "ours",
      amount: "20000000",
      period_key: "2027-Q1",
    });
    expect(
      (await call("hA", "PUT", `/p/contracts/${id}/periods/2027-Q1`, { figure: 9 })).status,
    ).toBe(422);
  });

  it("Hợp tác có chia theo quý: 4 đối soát + gia hạn, ghi lợi nhuận ⇒ phần mình 60%, đối tác 40%", async () => {
    const id = await draft("cooperation", "sale", "2027-01-01", "2027-12-31");
    await call("hA", "PUT", `/p/contracts/${id}/kind-terms`, {
      terms: {
        scope: "Tuyến miền Tây",
        split_basis: "profit",
        our_share_pct: 60,
        settle_period: "quarter",
      },
    });
    await toDone(id);
    const rows = await obl(id);
    expect(rows.map((r) => r.period_key)).toEqual([
      "2027-Q1",
      "2027-Q2",
      "2027-Q3",
      "2027-Q4",
      null,
    ]);
    const r = await call("hA", "PUT", `/p/contracts/${id}/periods/2027-Q1`, {
      figure: 500_000_000,
    });
    expect(r.json).toMatchObject({
      figure_kind: "profit",
      our_share: 300_000_000,
      partner_share: 200_000_000,
      report: { status: "done" },
    });
  });

  it("Hợp tác «không chia»: chỉ nhắc gia hạn, không có kỳ, bị loại khỏi điều kiện doanh thu/business", async () => {
    const none = await draft("cooperation", "sale", "2027-01-01", "2027-12-31");
    await call("hA", "PUT", `/p/contracts/${none}/kind-terms`, {
      terms: { scope: "Ghi nhớ", split_basis: "none" },
    });
    await toDone(none);
    expect((await obl(none)).map((r) => r.kind)).toEqual(["renewal"]);
    const money = await draft("cooperation", "sale", "2027-01-01", "2027-12-31");
    await call("hA", "PUT", `/p/contracts/${money}/kind-terms`, {
      terms: { scope: "Có chia", split_basis: "revenue", our_share_pct: 50, settle_period: "year" },
    });
    const ids = await uow().tenant({ tenantId: c.A, userId: c.hA }, async (r) => {
      const rows = (await r.tx.execute(dsql`select c.id from contracts.contracts c
        where c.tenant_id = ${c.A}::uuid and c.id in (${none}::uuid, ${money}::uuid) and ${countsMoneySql("c")}`)) as unknown as {
        id: string;
      }[];
      return rows.map((x) => x.id);
    });
    expect(ids).toEqual([money]);
  });
});
