// HD8-NFR-01 · HD8-FR-02 · bảo vệ parity khi gom sổ ở SQL: trên sổ NGẪU NHIÊN (nhiều hạt giống — dòng huỷ, ngoài khoảng, tương lai,
// cùng/không mã đợt, quá hạn hai loại, chấm tay trùng ngày + trùng `rated_at`, `with_us` vắng/false/null/chuỗi/0/[] + hạn vắng/sai dạng, chỉnh tay, đối tác không
// có dòng nào, ca làm tròn nửa về chẵn), đường SQL (`partnerData` ⇒ `Agg`) phải ra ĐÚNG `aggregate()` của TS trên từng dòng, và
// `scoreAgg(SQL)` ≡ `score(từng dòng)` (engine mgmt) với cấu hình ngẫu nhiên. Sai một đơn vị ⇒ đỏ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withPackScope } from "@ai/db/pack-scope";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { partnerData } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/partners-data.repo";
import { addDays } from "../../../apps/hub-api/src/modules/packs/contracts/domain/local-time.rules";
import { aggKey } from "../../../apps/hub-api/src/modules/packs/contracts/domain/partners.rules";
import {
  score,
  scoreAgg,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/scoring.rules";
import {
  aggregate,
  type Ev,
  emptyAgg,
  windowOf,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/scoring-agg.rules";
import {
  type Criterion,
  defaultConfig,
  normalise,
  type Role,
  type Rules,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/scoring-config.rules";
import { HUB_API_URL } from "../H1/_fixtures";
import { arrangeHd8, type CtxN1, P, startHd1, T } from "./_support/hd8";

const TODAY = "2026-10-20";
let c: CtxN1;
let db: ReturnType<typeof connectDb>;
beforeAll(async () => {
  c = await startHd1();
  db = connectDb(HUB_API_URL, 2);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await c?.stop();
});

/** PRNG có hạt giống (mulberry32) ⇒ lặp lại được. */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]) => xs[int(0, xs.length - 1)] as T;
  return { next, int, pick };
}

const TYPES = [
  "received",
  "received",
  "delivered",
  "delivered",
  "paid",
  "postponed",
  "reminded",
  "appointment_kept",
  "appointment_missed",
  "complaint",
  "cks_renewed",
  "cks_lapsed",
  "manual_adjust",
  "rating",
  "overdue",
  "overdue",
] as const;
const CRITERIA = ["custom:thai-do-hop-tac", "custom:chat-luong-hang"];

type Row = {
  party: string;
  role: Role;
  type: string;
  at: string;
  days_late: number | null;
  ob: string | null;
  data: Record<string, unknown>;
  voided: boolean;
};

type R = ReturnType<typeof rng>;

/** `data` ngẫu nhiên theo loại dòng (quá hạn, chỉnh tay, chấm tay, gia hạn CKS). */
function dataOf(r: R, type: string, at: string): Record<string, unknown> {
  if (type === "overdue")
    return {
      party_late: r.next() < 0.75,
      kind: r.pick(["payment", "delivery", null]),
      // review HD78 #5: hạn vắng/sai dạng ⇒ trễ 1 (TS ≡ SQL)
      ...(r.next() < 0.2
        ? {}
        : { due_date: r.pick([addDays(at, -1), addDays(at, -1), "không-phải-ngày"]) }),
      seq: 1,
    };
  if (type === "manual_adjust") return { delta: r.pick([-10, -3, 2, 7, 10]) };
  if (type === "rating")
    return {
      criterion: r.pick(CRITERIA),
      value: r.int(0, 100),
      rated_at: r.pick([
        "2026-10-10T09:00:00+00:00",
        "2026-10-10T10:00:00+00:00",
        "2026-10-10T09:00:00+00:00",
      ]),
    };
  if (type !== "cks_renewed") return {};
  const data: Record<string, unknown> = { days_before_expiry: r.pick([-30, -6, -1, 0, 9, null]) };
  // vắng / false / null / true / chuỗi "false" / "" / 0 / [] / "0" (review HD78 #5: truthiness của Python, TS ≡ SQL)
  const wu = r.int(0, 9);
  if (wu) data.with_us = [false, null, true, "false", "", 0, [], "0", {}][wu - 1];
  return data;
}

function rowOf(r: R, party: string, role: Role, obs: string[]): Row {
  const type = r.pick(TYPES);
  const at = addDays(TODAY, -r.int(-5, 900)); // có dòng tương lai và ngoài mọi khoảng tính
  const settles = ["received", "delivered", "paid"].includes(type);
  return {
    party,
    role,
    type,
    at,
    days_late: settles ? r.pick([0, 0, null, 1, 3, 12]) : null,
    ob: settles || type === "postponed" || type === "overdue" ? r.pick([...obs, null]) : null,
    data: dataOf(r, type, at),
    voided: r.next() < 0.08,
  };
}

function ledger(seed: number, parties: number) {
  const r = rng(seed);
  const obs = Array.from(
    { length: 6 },
    (_, i) => `0e000000-0000-4000-8000-${String(seed * 100 + i).padStart(12, "0")}`,
  );
  const rows: Row[] = [];
  for (let p = 0; p < parties; p++) {
    const party = `tax:09${String(seed).padStart(3, "0")}${String(p).padStart(5, "0")}`;
    const role: Role = p % 2 ? "supplier" : "customer";
    const n = p % 7 === 6 ? 0 : r.int(1, 25); // vài đối tác không có dòng nào
    for (let i = 0; i < n; i++) rows.push(rowOf(r, party, role, obs));
  }
  return rows;
}
function randomCfg(seed: number, role: Role): { criteria: Criterion[]; rules: Rules } {
  const r = rng(seed * 31 + (role === "customer" ? 1 : 2));
  const base = defaultConfig(role);
  const crit = normalise([
    ...base.criteria.map((x) => ({ ...x, enabled: r.next() < 0.85 })),
    {
      kind: "manual",
      label: role === "customer" ? "Thái độ hợp tác" : "Chất lượng hàng",
      enabled: true,
      weight: 0,
    },
  ]);
  const weights = crit.map(() => r.int(0, 9));
  const on = crit.map((x) => x.enabled);
  if (!on.some(Boolean)) on[0] = true;
  const sum = weights.reduce((s, w, i) => s + (on[i] ? w : 0), 0) || 1;
  let left = 100;
  const criteria = crit.map((x, i) => {
    const w = on[i] ? Math.floor((100 * (weights[i] as number)) / sum) : (weights[i] as number);
    if (on[i]) left -= w;
    return { ...x, enabled: on[i] as boolean, weight: w };
  });
  const first = criteria.findIndex((x) => x.enabled);
  (criteria[first] as Criterion).weight += left;
  const wm = r.pick([1, 3, 12, 24, 60]);
  const rules: Rules = {
    good_from: 80,
    fair_from: 60,
    min_events: r.pick([0, 1, 3, 5]),
    window_months: wm,
    recency_boost: r.next() < 0.6,
    recency_months: Math.min(wm, r.pick([1, 2, 3, 6])),
    manual_adjust: r.next() < 0.7,
  };
  return { criteria, rules };
}

async function insert(rows: Row[]): Promise<Map<string, Ev[]>> {
  const by = new Map<string, Ev[]>();
  for (const x of rows) {
    const [e] = await c.sql<
      { id: string }[]
    >`insert into contracts.partner_events (tenant_id, party_key, role, type, at,
        source, obligation_id, days_late, data)
      values (${T.acme}, ${x.party}, ${x.role}, ${x.type}, ${x.at}, 'action', ${x.ob}, ${x.days_late},
        ${c.sql.json(x.data as never)}) returning id::text`;
    if (x.voided)
      await c.sql`insert into contracts.partner_event_voids (event_id, tenant_id) values (${e?.id as string}, ${T.acme})`;
    const ev: Ev = {
      ...(x.data as object),
      type: x.type,
      at: x.at,
      voided: x.voided,
      days_late: x.days_late,
      obligation_id: x.ob,
      by: null,
    };
    const key = aggKey(x.party, x.role);
    by.set(key, [...(by.get(key) ?? []), ev]);
  }
  return by;
}

describe("HD8-NFR-01 · gom SQL ≡ engine trên từng dòng (sổ ngẫu nhiên)", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`hạt giống ${seed}: Agg SQL = aggregate TS; scoreAgg(SQL) = score(từng dòng)`, async () => {
      await arrangeHd8(c);
      const rows = ledger(seed, 18);
      const events = await insert(rows);
      const cfg = { customer: randomCfg(seed, "customer"), supplier: randomCfg(seed, "supplier") };
      const ov = { customer: cfg.customer.rules, supplier: cfg.supplier.rules };
      const data = await withPackScope(
        db,
        { packKey: "contracts", tenantId: T.acme, userId: P.lan.id },
        (tx) => partnerData(tx, T.acme, TODAY, ov),
      );
      const keys = new Set([...rows.map((x) => aggKey(x.party, x.role)), ...data.aggs.keys()]);
      for (const key of keys) {
        const role = key.split("|")[0] as Role;
        const evs = events.get(key) ?? [];
        const want = aggregate(evs, windowOf(cfg[role].rules, TODAY), role);
        const got = data.aggs.get(key) ?? emptyAgg();
        expect({ key, agg: got }).toEqual({ key, agg: want });
        const facts = {
          contracts: (seed % 3) + 1,
          first_start: seed % 2 ? "2024-01-15" : null,
          price_gap_pct: role === "supplier" ? seed * 1.25 : null,
        };
        expect({ key, s: scoreAgg(got, cfg[role], TODAY, role, facts) }).toEqual({
          key,
          s: score(evs, cfg[role], TODAY, role, facts),
        });
      }
    }, 60_000);
  }

  it("ca làm tròn nửa về chẵn qua SQL: 5 lần nhắc / 2 HĐ ⇒ 62 (round(62.5)); đối tác không dòng nào ⇒ chưa có điểm", async () => {
    await arrangeHd8(c);
    const party = "tax:0988888888";
    const rows: Row[] = [
      ...Array.from(
        { length: 5 },
        (_, i): Row => ({
          party,
          role: "customer",
          type: "reminded",
          at: addDays(TODAY, -10 - i),
          days_late: null,
          ob: null,
          data: {},
          voided: false,
        }),
      ),
      ...Array.from(
        { length: 3 },
        (_, i): Row => ({
          party,
          role: "customer",
          type: "received",
          at: addDays(TODAY, -20 - i),
          days_late: 0,
          ob: null,
          data: {},
          voided: false,
        }),
      ),
    ];
    await insert(rows);
    const cfg = defaultConfig("customer");
    const data = await withPackScope(
      db,
      { packKey: "contracts", tenantId: T.acme, userId: P.lan.id },
      (tx) => partnerData(tx, T.acme, TODAY),
    );
    const s = scoreAgg(
      data.aggs.get(aggKey(party, "customer")) ?? emptyAgg(),
      cfg,
      TODAY,
      "customer",
      { contracts: 2 },
    );
    expect(s.breakdown.reminders?.value).toBe(62);
    expect(scoreAgg(emptyAgg(), cfg, TODAY, "customer", {}).score).toBeNull();
  }, 60_000);
});
