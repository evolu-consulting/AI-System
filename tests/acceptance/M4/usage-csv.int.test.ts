// ADM-FR-42 · M4-R08 · BR-09 · GET /admin/usage.csv (test-plan C1–C3; M4-AC03, M4-AC16). Dữ liệu như usage.int (U).
// Xanh ở T5.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  bytesOf,
  createM4Env,
  expectErr4,
  ID,
  inPrevMonth,
  insertUsage,
  type M4Env,
  resetNow,
  TENANT_ID,
  vnDate,
  vnMonthStart,
} from "./_ab";

let env: M4Env;
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;
const KT = ID.feature.keToan;
const FROM = () => vnDate(vnMonthStart(new Date()));
const TO = () => vnDate(new Date(vnMonthStart(new Date(), 1).getTime() - 1000));
const range = () => `from=${FROM()}&to=${TO()}`;
const BOM = "﻿";
const H_TENANT =
  "date,tenant_key,feature_key,runs,input_tokens,output_tokens,billable_usd,overage_runs";
const H_PLATFORM =
  "date,tenant_key,feature_key,runs,input_tokens,output_tokens,billable_usd,cost_usd,overage_runs";

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
  const o = env.owner;
  await insertUsage(o, 1, { tenant: A, feature: KT, runFrom: 0 });
  await insertUsage(o, 1, { tenant: A, feature: KT, runFrom: 1, overage: true });
  await insertUsage(o, 1, { tenant: A, feature: KT, runFrom: 2 });
  await insertUsage(o, 1, { tenant: A, feature: KT, runFrom: 2 });
  await insertUsage(o, 1, { tenant: A, runFrom: 3, billable: null });
  await insertUsage(o, 2, { tenant: G, feature: KT, runFrom: 10 });
  await insertUsage(o, 4, { tenant: A, runFrom: 20, at: inPrevMonth() });
});

/** Tách CSV: bỏ BOM, tách CRLF, bỏ dòng rỗng cuối; ô tách theo dấu phẩy (dữ liệu test không có dấu phẩy/ngoặc kép). */
function rows(text: string): string[][] {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  return body
    .split("\r\n")
    .filter((l) => l !== "")
    .map((l) => l.split(","));
}
const csv = async (q: string, user?: string) =>
  user
    ? env.by("acme", user)("GET", `/admin/usage.csv?${q}`)
    : env.as("GET", `/admin/usage.csv?${q}`);

describe("ADM-FR-42 · M4-AC16 · CSV", () => {
  it('ADM-FR-42 · M4-R08 · M4-AC16 · C1 · admin acme: BOM, CRLF, header platform, text/csv utf-8, file usage-acme-{from}-{to}.csv; Σ runs = kpi.runs; NULL → ""', async () => {
    const res = await csv(`tenant_id=${A}&${range()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="usage-acme-${FROM()}-${TO()}.csv"`,
    );
    // BOM kiểm ở byte: WHATWG UTF-8 decode (res.text()) luôn bỏ BOM đầu → `text` là phần sau BOM.
    expect([...bytesOf(res).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(res.text.startsWith(BOM)).toBe(false);
    expect(res.text.replace(/\r\n/g, "")).not.toContain("\n");
    const r = rows(res.text);
    expect(r[0]?.join(",")).toBe(H_PLATFORM);
    const data = r.slice(1);
    const sum = data.reduce((s, c) => s + Number(c[3]), 0);
    const json = await env.as("GET", `/admin/usage?tenant_id=${A}&${range()}`);
    expect(json.status).toBe(200);
    expect(sum).toBe(json.json.kpi.runs);
    expect(sum).toBe(4);
    const nul = data.find((c) => c[2] === "");
    expect(nul).toBeDefined();
    expect(nul?.[1]).toBe("acme");
    expect(nul?.[6]).toBe("");
    expect(data.every((c) => c[1] === "acme")).toBe(true);
    expect(data.map((c) => c[8]).reduce((s, v) => s + Number(v), 0)).toBe(1);
  });

  it("ADM-FR-42 · M4-R08 · M4-AC03 · C2 · binh: header không cost_usd; toàn văn không có 'cost_usd' hay '0.06'; filename usage-acme-…", async () => {
    const res = await csv(range(), "binh");
    expect(res.status).toBe(200);
    expect(rows(res.text)[0]?.join(",")).toBe(H_TENANT);
    expect(res.text).not.toContain("cost_usd");
    expect(res.text).not.toContain("0.06");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="usage-acme-${FROM()}-${TO()}.csv"`,
    );
    expect(
      rows(res.text)
        .slice(1)
        .every((c) => c[1] === "acme"),
    ).toBe(true);
  });

  it("ADM-BR-09 · C3 · binh tenant_id=globex → 404; admin không tenant → usage-all-…, có dòng globex", async () => {
    expectErr4(await csv(`tenant_id=${G}`, "binh"), "NOT_FOUND");
    const res = await csv(range());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="usage-all-${FROM()}-${TO()}.csv"`,
    );
    const data = rows(res.text).slice(1);
    expect(data.filter((c) => c[1] === "globex").reduce((s, c) => s + Number(c[3]), 0)).toBe(2);
    expect(data.filter((c) => c[1] === "acme").reduce((s, c) => s + Number(c[3]), 0)).toBe(4);
  });
});
