// I1 · review B/C (lát i1c-fixes): chữ ký trỏ lô bị bỏ ⇒ lot_id null + LOT_MISSING (không rollback FK); REL có đoạn làm chứng
// không được nhập ⇒ không chép sang tenant nào khác. Dữ liệu GIẢ.
import { describe, expect, test } from "bun:test";
import { companyIndex } from "./companies.rules";
import type { Ctx, Snapshot } from "./context";
import { sha1, toHex } from "./ids.rules";
import { mapCks } from "./map-cks.rules";
import { mapKnowledge } from "./map-knowledge.rules";
import { newPlan, tenantPlan } from "./plan";
import type { Issue } from "./values.rules";

const TA = "00000000-0000-4000-8000-00000000000a";
const TB = "00000000-0000-4000-8000-00000000000b";
const ctxOf = (issues: Issue[], knowledgeOrg: string | null = null): Ctx => ({
  source: "t",
  tenantOf: (o) => (o === "A" ? TA : o === "B" ? TB : null),
  userOf: () => null,
  fallbackUser: () => "owner",
  knowledgeOrg,
  issues,
});
const d = (id: string, src: Record<string, unknown>) => ({ id, src });

describe("review B#21 · lô bị bỏ", () => {
  test("chữ ký trỏ lô thiếu/không hợp lệ ⇒ lot_id null + LOT_MISSING; lô hợp lệ ⇒ giữ", () => {
    const issues: Issue[] = [];
    const s: Snapshot = {
      graph: {},
      docs: {
        companies: [d("A|tax:01", { org_id: "A", name: "K", tax_id: "01" })],
        cks_lots: [
          d("ok", {
            org_id: "A",
            qty: 2,
            unit_cost: 5,
            bought_at: "2026-01-01",
            purchase_contract_id: "c",
          }),
          d("bad", {
            org_id: "A",
            qty: 0,
            unit_cost: 5,
            bought_at: "2026-01-01",
            purchase_contract_id: "c",
          }),
        ],
        cks_certificates: [
          d("k1", {
            org_id: "A",
            company_id: "A|tax:01",
            serial: "01",
            valid_to: "2027-01-01",
            holder_name: "x",
            lot_id: "ok",
          }),
          d("k2", {
            org_id: "A",
            company_id: "A|tax:01",
            serial: "02",
            valid_to: "2027-01-01",
            holder_name: "y",
            lot_id: "bad",
          }),
        ],
      },
    };
    const p = newPlan();
    mapCks(s, ctxOf(issues), p, companyIndex(s));
    const certs = p.tenants.get(TA)?.rows["contracts.cks_certificates"] ?? [];
    expect(certs.map((c) => c.lot_id === null)).toEqual([false, true]);
    expect(issues.map((i) => i.code)).toEqual(["LOT_INCOMPLETE", "LOT_MISSING"]);
  });
});

describe("review C#25 · REL không rải chéo tenant", () => {
  test("đoạn làm chứng không được nhập ⇒ REL không vào tenant nào; không có đoạn làm chứng ⇒ mọi tenant có cả hai đầu", () => {
    const issues: Issue[] = [];
    const doc = (id: string, h: string) =>
      d(id, { domain: "contract", content_hash: h.repeat(64), title: id });
    const s: Snapshot = {
      docs: {
        contracts: [d("ca", { org_id: "A" }), d("cb", { org_id: "B" })],
        documents: [doc("ca", "a"), doc("cb", "b")],
        chunks: [
          d("ca:0", { doc_id: "ca", chunk_index: 0, text: "x" }),
          d("cb:0", { doc_id: "cb", chunk_index: 0, text: "y" }),
        ],
      },
      graph: {
        entities: [
          ["P:a", "A", "Person"],
          ["P:b", "B", "Person"],
        ],
        mentions: [
          ["ca:0", "P:a"],
          ["ca:0", "P:b"],
          ["cb:0", "P:a"],
          ["cb:0", "P:b"],
        ],
        rels: [
          ["P:a", "P:b", "KNOWS", "gone:0"],
          ["P:a", "P:b", "WORKS_WITH", "ca:0"],
          ["P:b", "P:a", "GLOBAL", null],
        ],
      },
    };
    const p = newPlan();
    tenantPlan(p, TA, "A");
    tenantPlan(p, TB, "B");
    mapKnowledge(
      s,
      ctxOf(issues),
      p,
      new Map([
        ["ca", "A"],
        ["cb", "B"],
      ]),
    );
    const types = (t: string) =>
      (p.tenants.get(t)?.rows["knowledge.entity_rels"] ?? []).map((r) => r.type).sort();
    expect(types(TA)).toEqual(["GLOBAL", "WORKS_WITH"]);
    expect(types(TB)).toEqual(["GLOBAL"]);
  });
});

describe("review C · SHA-1 thuần (không node:crypto ở domain)", () => {
  test("vector FIPS 180: '' / 'abc' / 448 bit", () => {
    const h = (s: string) => toHex(sha1(new TextEncoder().encode(s)));
    expect(h("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(h("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(h("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "84983e441c3bd26ebaae4aa1f95129e5e54670f1",
    );
  });
});
