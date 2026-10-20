// M2-chat · tool đọc của trợ lý (unit, use case giả): danh tính = user + tenant của lời gọi, chỉ đọc, kiểm tham số, cắt gọn.
import { describe, expect, it } from "bun:test";
import type { PackToolCtx, PackToolDef } from "../../kit/application/pack-tools.ports";
import {
  ASSISTANT_TOOL_KEYS,
  type AssistantToolDeps,
  assistantTools,
  LIMIT_MAX,
} from "./assistant.tools";

const T = "01900000-0000-7000-8000-00000000a001";
const U = "01900000-0000-7000-8000-00000000b001";
const C = "01900000-0000-7000-8000-00000000c001";
const ctx: PackToolCtx = { tenantId: T, userId: U, runId: "r1", processRunId: null };

type Call = { fn: string; who: unknown; arg: unknown };
const row = (i: number) => ({
  id: `${C.slice(0, -3)}${String(i).padStart(3, "0")}`,
  kind: "contract",
  title: `HĐ ${i}`,
  number: null,
  status: "active",
  direction: "sell",
  seller: "A",
  buyer: "B",
  value: 1000,
  end_date: null,
  action_deadline: null,
  owner_user_id: U,
  seller_signer: null,
  buyer_signer: null,
  parent_id: null,
  type: null,
  category_ids: [],
  updated_at: "2026-10-19T00:00:00.000Z",
  version: 1,
});
function ledgerFakes(calls: Call[]) {
  return {
    payments: async (who: unknown, filter: string) => {
      calls.push({ fn: "payments", who, arg: filter });
      return {
        stats: { overdue_count: 1 },
        rows: Array.from({ length: 50 }, (_, i) => ({ i })),
        total: 50,
      };
    },
    obligations: async (who: unknown, q: unknown) => {
      calls.push({ fn: "obligations", who, arg: q });
      return [{ id: "o1" }];
    },
  };
}
function fakes() {
  const calls: Call[] = [];
  const deps = {
    list: async (who: unknown, q: { page_size: number }) => {
      calls.push({ fn: "list", who, arg: q });
      return {
        total: 99,
        items: Array.from({ length: q.page_size }, (_, i) => row(i)),
        parents: [],
        page: 1,
        page_size: q.page_size,
      };
    },
    detail: async (who: unknown, id: string) => {
      calls.push({ fn: "detail", who, arg: id });
      if (id !== C) return null;
      return {
        ...row(1),
        clauses: ["dài"],
        file: { name: "x" },
        created_by: U,
        confirmed_by: U,
        events: Array.from({ length: 12 }, (_, i) => ({ i })),
      };
    },
    cks: {
      customers: async (who: unknown, f: unknown) => {
        calls.push({ fn: "cks", who, arg: f });
        return { items: [{ company_id: "k" }], total: 1, page: 1, page_size: 10, cas: [] };
      },
    },
    ledger: ledgerFakes(calls),
  } as unknown as AssistantToolDeps;
  return { deps, calls };
}
const tool = (ts: PackToolDef[], k: string) => ts.find((t) => t.name === k) as PackToolDef;
const WHO = { tenantId: T, userId: U };

describe("M2-chat · tool đọc gói contracts cho trợ lý [N2-FR-03]", () => {
  it("4 tool `contracts-*`, đều action read, không side_effect", () => {
    const ts = assistantTools(fakes().deps);
    expect(ts.map((t) => t.name)).toEqual(Object.values(ASSISTANT_TOOL_KEYS));
    for (const t of ts) {
      expect(t.pack).toBe("contracts");
      expect(t.action).toBe("read");
      expect(t.side_effect).toBe(false);
    }
  });

  it("search: danh tính = user + tenant của lời gọi; limit trần LIMIT_MAX; hàng tóm tắt", async () => {
    const f = fakes();
    const out = (await tool(assistantTools(f.deps), "contracts-search").run(ctx, {
      q: "bao bì",
      status: "active",
      limit: 500,
    })) as { total: number; items: Record<string, unknown>[] };
    expect(f.calls[0]?.who).toEqual(WHO);
    expect(f.calls[0]?.arg).toMatchObject({
      q: "bao bì",
      status: ["active"],
      page_size: LIMIT_MAX,
    });
    expect(out.total).toBe(99);
    expect(out.items).toHaveLength(LIMIT_MAX);
    expect(Object.keys(out.items[0] ?? {})).not.toContain("owner_user_id");
  });

  it("search: trạng thái lạ / q 1 ký tự ⇒ ném, không gọi use case", async () => {
    const f = fakes();
    const t = tool(assistantTools(f.deps), "contracts-search");
    await expect(t.run(ctx, { status: "drop table" })).rejects.toThrow();
    await expect(t.run(ctx, { q: "x" })).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });
});

describe("M2-chat · tool đọc gói contracts cho trợ lý (get, cks, ledger)", () => {
  it("get: id sai dạng ⇒ ném; không thấy (RLS/tenant khác) ⇒ found false; có ⇒ bỏ clauses/file, ≤ 5 việc", async () => {
    const f = fakes();
    const t = tool(assistantTools(f.deps), "contracts-get");
    await expect(t.run(ctx, { contract_id: "1 or 1=1" })).rejects.toThrow();
    expect(await t.run(ctx, { contract_id: "01900000-0000-7000-8000-00000000ffff" })).toEqual({
      found: false,
    });
    const got = (await t.run(ctx, { contract_id: C })) as { contract: Record<string, unknown> };
    expect(got.contract.clauses).toBeUndefined();
    expect(got.contract.file).toBeUndefined();
    expect(got.contract.events).toHaveLength(5);
    expect(f.calls.every((c) => JSON.stringify(c.who) === JSON.stringify(WHO))).toBe(true);
  });

  it("cks: lọc hợp lệ đi qua; lọc lạ ⇒ ném", async () => {
    const f = fakes();
    const t = tool(assistantTools(f.deps), "contracts-cks");
    await t.run(ctx, { filter: "expiring", q: "minh" });
    expect(f.calls[0]).toMatchObject({
      fn: "cks",
      who: WHO,
      arg: { filter: "expiring", q: "minh" },
    });
    await expect(t.run(ctx, { filter: "all-tenants" })).rejects.toThrow();
  });

  it("ledger: có contract_id ⇒ đợt của HĐ; không ⇒ tổng quan theo filter, rows cắt theo limit", async () => {
    const f = fakes();
    const t = tool(assistantTools(f.deps), "contracts-ledger");
    expect(await t.run(ctx, { contract_id: C })).toEqual({ obligations: [{ id: "o1" }] });
    const p = (await t.run(ctx, { filter: "overdue", limit: 3 })) as { rows: unknown[] };
    expect(p.rows).toHaveLength(3);
    expect(f.calls.map((c) => [c.fn, c.arg])).toEqual([
      ["obligations", { contract_id: C }],
      ["payments", "overdue"],
    ]);
    await expect(t.run(ctx, { filter: "x" })).rejects.toThrow();
  });
});
