// CR-151e · `GET /pack/contracts/partners/page` (Đối tác phân trang ở máy chủ, cả hai engine HD8 / V2-E): trang 2 đúng, điểm trên trang =
// điểm engine tính toàn bộ (cùng dữ liệu), sắp theo điểm, trần limit 200, N2 (người đọc KHÁC người tạo), chéo tenant, số câu SQL cố định
// + thời gian với 1.000 đối tác. Route thật + pool hub_api + RLS.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { PartyItem, PartyPage, RepPartnerRow } from "@ai/contracts/pack-contracts";
import { fromRep, lowestScore } from "@ai/contracts/pack-contracts";
import { createDb, type Db } from "@ai/db";
import { enablePack, members, tenants, users, visibility } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { mapError } from "../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import type { RepEngine } from "./domain/rep-current.rules";
import { partnersModule } from "./partners.mount";
import { v2eReads } from "./rep-current.mount";

const N = 1_000;
const BOTH = 300; // i < BOTH: cả khách lẫn NCC (hai vai trong MỘT dòng)
let sql: Sql;
let db: Db;
let A = "";
let B = "";
let creator = "";
let reader = "";
let outsider = "";
let other = "";
let engine: RepEngine = "hd8";
const F = { read: "f-r", write: "f-w", admin: "f-a" };
const NOW = () => new Date("2026-11-14T03:00:00Z");
const deps = { timeZoneOf: async () => "Asia/Ho_Chi_Minh", now: NOW, engine: () => engine };

function app(user: string, tenant: string, groups: string[]) {
  const view: PackAccessView = {
    catalog: async () => ({
      features: [
        { id: F.read, key: "contracts-read", status: "on" },
        { id: F.write, key: "contracts-write", status: "on" },
        { id: F.admin, key: "contracts-admin", status: "on" },
      ],
      entitled: new Set([A, B].flatMap((t) => Object.values(F).map((f) => `${t}:${f}`))),
      grantGroups: new Map(
        [A, B].flatMap((t) => [
          [`${t}:${F.read}`, ["g-own", "g-edit"]],
          [`${t}:${F.write}`, ["g-own", "g-edit"]],
          [`${t}:${F.admin}`, ["g-own"]],
        ]),
      ),
    }),
    user: async () => ({ tenantId: tenant, groupIds: new Set(groups) }),
  };
  const h = new Hono<PackGuardVars>();
  h.use("*", async (c, next) => {
    c.set("user", { userId: user, tenantId: tenant, role: "member" } as never);
    await next();
  });
  h.route("/", partnersModule(db, view, deps));
  h.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return h;
}
const get = async <T>(h: Hono<PackGuardVars>, path: string) => {
  const r = await h.request(path);
  return { status: r.status, body: (await r.json()) as T };
};
const page = (h: Hono<PackGuardVars>, qs = "") => get<PartyPage>(h, `/partners/page?${qs}`);

/** `N` đối tác (khoá tax:0310…), mỗi vai một HĐ `done`; sổ việc cho từng vai; cờ đỏ (gian lận) cho i % 97 = 0. */
async function seed() {
  await sql`insert into contracts.contracts (id, tenant_id, title, direction, status, effect, created_by, fields)
    select gen_random_uuid(), ${A}, 'HĐ ' || g.i || d.dir, d.dir, 'done', 'active', ${creator},
      jsonb_build_object('start_date', jsonb_build_object('value', '2025-01-01'),
        'buyer_name', jsonb_build_object('value', 'Đối tác ' || lpad(g.i::text, 4, '0')),
        'buyer_tax_id', jsonb_build_object('value', '0310' || lpad(g.i::text, 6, '0')),
        'supplier_name', jsonb_build_object('value', 'Đối tác ' || lpad(g.i::text, 4, '0')),
        'supplier_tax_id', jsonb_build_object('value', '0310' || lpad(g.i::text, 6, '0')))
    from generate_series(0, ${N - 1}) g(i)
    cross join (values ('sale'), ('purchase')) d(dir)
    where (d.dir = 'sale' and (g.i % 2 = 0 or g.i < ${BOTH})) or (d.dir = 'purchase' and (g.i % 2 = 1 or g.i < ${BOTH}))`;
  await sql`insert into contracts.partner_events (tenant_id, party_key, role, grp, type, at, source, days_late)
    select ${A}, 'tax:0310' || lpad(g.i::text, 6, '0'), r.role, 'goods',
      case when r.role = 'customer' then (case when g.i % 97 = 0 and e = 1 then 'fraud' when (g.i + e) % 5 = 0 then 'reminded' else 'received' end) else 'delivered' end,
      current_date - ((g.i * 7 + e * 31) % 300), 'action', case when (g.i + e) % 4 = 0 then 3 else 0 end
    from generate_series(0, ${N - 1}) g(i)
    cross join (values ('customer'), ('supplier')) r(role)
    cross join generate_series(1, 4) e
    where (r.role = 'customer' and (g.i % 2 = 0 or g.i < ${BOTH})) or (r.role = 'supplier' and (g.i % 2 = 1 or g.i < ${BOTH}))`;
}

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A, B] = (await tenants(sql, 2, 1511)) as [string, string];
  [creator, reader, outsider] = (await users(sql, A, 3, { from: 1511 })) as [
    string,
    string,
    string,
  ];
  [other] = (await users(sql, B, 1, { from: 1521 })) as [string];
  const roles = await enablePack(sql, [A, B], "contracts");
  await members(sql, A, roles.get(A)?.owner as string, [creator]);
  await visibility(sql, [A, B], "tenant");
  await seed();
  await sql`analyze contracts.contracts, contracts.partner_events`;
  db = createDb(urls().hubApi, { max: 4 });
}, 180_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

const asReader = () => app(reader, A, ["g-edit"]); // KHÁC người tạo HĐ (N2)

/** Mọi đối tác qua các trang `limit=200` (kiểm trần + nối trang). */
async function walk(h: Hono<PackGuardVars>, qs: string) {
  const out: PartyItem[] = [];
  let off = 0;
  for (let i = 0; i < 20; i++) {
    const r = await page(h, `${qs}&limit=200&offset=${off}`);
    expect(r.status).toBe(200);
    out.push(...r.body.items);
    if (r.body.next_offset === null) return { out, total: r.body.total };
    off = r.body.next_offset;
  }
  throw new Error("quá nhiều trang");
}

/** Điểm từng (đối tác, vai) từ endpoint CŨ trả toàn bộ: HD8 `GET /partners?role=`, V2-E `listFlagged` (nguồn `/reputation/partners`). */
async function oldScores(h: Hono<PackGuardVars>, eng: RepEngine) {
  const m = new Map<string, number | null>();
  if (eng === "hd8") {
    for (const role of ["customer", "supplier"]) {
      const r = await get<{ party: string; score: number | null }[]>(h, `/partners?role=${role}`);
      for (const x of r.body) m.set(`${x.party}|${role}`, x.score);
    }
    return m;
  }
  const rep = await v2eReads(db, deps).listFlagged({ tenantId: A, userId: reader }, "all");
  for (const r of rep as RepPartnerRow[]) m.set(`${r.party}|${r.role}`, fromRep(r).score);
  return m;
}

for (const eng of ["hd8", "v2e"] as const) {
  describe(`CR-151e · Đối tác phân trang ở máy chủ · engine ${eng}`, () => {
    beforeAll(() => {
      engine = eng;
    });

    it("trang 2 đúng: total, next_offset, không trùng, quá cuối rỗng, người đọc khác người tạo (N2)", async () => {
      engine = eng;
      const h = asReader();
      const p1 = await page(h, "limit=20&offset=0");
      const p2 = await page(h, "limit=20&offset=20");
      expect(p1.status).toBe(200);
      expect(p1.body.items).toHaveLength(20);
      expect(p1.body.next_offset).toBe(20);
      expect(p2.body.total).toBe(p1.body.total);
      expect(p2.body.items).toHaveLength(20);
      const ids1 = new Set(p1.body.items.map((i) => i.party));
      expect(p2.body.items.some((i) => ids1.has(i.party))).toBe(false);
      const all = await walk(h, "");
      expect(all.out).toHaveLength(all.total);
      expect(new Set(all.out.map((i) => i.party)).size).toBe(all.total);
      expect(all.total).toBeGreaterThan(0);
      const past = await page(h, `limit=20&offset=${all.total + 5}`);
      expect(past.body).toEqual({ items: [], total: all.total, next_offset: null });
    });

    it("điểm trên trang = điểm engine tính toàn bộ (cùng dữ liệu, cùng nguồn)", async () => {
      engine = eng;
      const h = asReader();
      const full = await walk(h, "sort=name");
      const byParty = new Map(full.out.map((i) => [i.party, i]));
      const p = await page(h, "sort=name&limit=25&offset=50");
      expect(p.body.items.length).toBeGreaterThan(0);
      for (const it of p.body.items) expect(it).toEqual(byParty.get(it.party) as PartyItem);
      // nguồn đối chiếu = endpoint cũ trả TOÀN BỘ
      const old = await oldScores(h, eng);
      for (const it of p.body.items)
        for (const r of it.roles) expect(r.score).toBe(old.get(`${it.party}|${r.role}`) ?? null);
    });

    it("sắp theo điểm tăng dần, chưa có điểm ở cuối, lọc vai và cờ đỏ, tìm tên kèm số HĐ", async () => {
      engine = eng;
      const h = asReader();
      const asc = await walk(h, "sort=score_asc");
      const keys = asc.out.map(lowestScore);
      const firstNull = keys.indexOf(null);
      const nums = (firstNull < 0 ? keys : keys.slice(0, firstNull)) as number[];
      expect(nums.every((v, i) => i === 0 || (nums[i - 1] as number) <= v)).toBe(true);
      if (firstNull >= 0) expect(keys.slice(firstNull).every((k) => k === null)).toBe(true);
      const sup = await walk(h, "filter=supplier");
      expect(sup.out.length).toBeGreaterThan(0);
      expect(sup.out.every((i) => i.roles.some((r) => r.role === "supplier"))).toBe(true);
      const flag = await walk(h, "filter=flag");
      expect(flag.out.every((i) => i.red_flag)).toBe(true);
      const one = await page(h, `q=${encodeURIComponent("doi tac 0042")}`);
      expect(one.body.items.map((i) => i.name)).toEqual(["Đối tác 0042"]);
      expect(one.body.items[0]?.contracts).toBeGreaterThanOrEqual(1);
    });

    it("trần limit=200 ra 200 dòng, limit=201 bị 400 không cắt im lặng, sort và filter lạ bị 400", async () => {
      engine = eng;
      const h = asReader();
      const ok = await page(h, "limit=200");
      expect(ok.body.items).toHaveLength(200);
      expect((await page(h, "limit=201")).status).toBe(400);
      expect((await page(h, "filter=bogus")).status).toBe(400);
      expect((await page(h, "sort=bogus")).status).toBe(400);
    });

    it("quyền và chéo tenant: không có quyền đọc bị 403, tenant khác không thấy đối tác của tenant A", async () => {
      engine = eng;
      expect((await page(app(outsider, A, []))).status).toBe(403);
      const foreign = await page(app(other, B, ["g-own"]), "limit=200");
      expect(foreign.status).toBe(200);
      expect(foreign.body).toEqual({ items: [], total: 0, next_offset: null });
    });
  });
}

type Dbg = { options?: { debug?: (...a: unknown[]) => void } };
describe("CR-151e · hiệu năng 1.000 đối tác (số câu SQL cố định mỗi trang)", () => {
  it("số câu SQL + thời gian mỗi trang", async () => {
    const d = db as unknown as { db?: { $client?: Dbg }; $client?: Dbg };
    const client = d.db?.$client ?? d.$client;
    const h = asReader();
    for (const eng of ["hd8", "v2e"] as const) {
      engine = eng;
      await page(h, "limit=20"); // làm nóng
      const counts: number[] = [];
      const times: number[] = [];
      const qss = [
        "limit=20&offset=0",
        "limit=20&offset=400",
        "limit=200&filter=flag",
        "limit=20&sort=score_asc&q=doi",
      ];
      for (const qs of qss) {
        let n = 0;
        const prev = client?.options?.debug;
        if (client?.options)
          client.options.debug = (...a: unknown[]) => {
            if (!/^\s*(begin|commit|rollback)/i.test(String(a[1] ?? ""))) n++;
          };
        const t0 = performance.now();
        const r = await page(h, qs);
        times.push(performance.now() - t0);
        if (client?.options) client.options.debug = prev as never;
        expect(r.status).toBe(200);
        counts.push(n);
      }
      console.log(
        `CR-151e ${eng} · ${N} đối tác · số câu SQL mỗi trang ${counts} · ms ${times.map((t) => t.toFixed(0))}`,
      );
      expect(new Set(counts).size).toBe(1); // cố định, không theo trang/lọc/tìm
      expect(counts[0]).toBeLessThanOrEqual(10);
    }
  }, 120_000);
});
