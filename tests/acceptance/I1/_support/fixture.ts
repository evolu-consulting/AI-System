// I1 · nguồn mgmt-app GIẢ (không dữ liệu khách thật) cho test importer: ảnh chụp nhỏ phủ mọi mapper + `SourceReader` bộ nhớ.
import type { SourceReader } from "../../../../apps/admin-api/src/modules/mgmt-import/application/ports";
import type {
  Snapshot,
  SourceDoc,
} from "../../../../apps/admin-api/src/modules/mgmt-import/domain/context";
import { A, doc, fields, ORG_A, ORG_B, SCRYPT } from "./fixture-base";
import { cks, knowledge, ledger, staged } from "./fixture-parts";

export { ORG_A, ORG_B, SCRYPT, SHA1, SHA2, SOURCE } from "./fixture-base";

const users = [
  ["a.owner@annam.test", "owner", null],
  ["m1@annam.test", "editor", null],
  ["e1@annam.test", "editor", "m1@annam.test"],
  ["v1@annam.test", "viewer", "e1@annam.test"],
  ["inv@annam.test", "viewer", null],
] as const;

function identity(): Record<string, SourceDoc[]> {
  return {
    orgs: [doc(ORG_A, { name: "Công ty An Nam" }), doc(ORG_B, { name: "Bờ Bê" })],
    users: [
      ...users.map(([email]) =>
        doc(email, { email, name: email.split("@")[0], password_hash: SCRYPT, role: null }),
      ),
      doc("b.owner@bb.test", {
        email: "b.owner@bb.test",
        name: "B",
        password_hash: SCRYPT,
        role: null,
      }),
      doc("staff@internal.test", {
        email: "staff@internal.test",
        name: "Staff",
        password_hash: SCRYPT,
        role: "admin",
      }),
    ],
    memberships: [
      ...users.map(([email, role, manager]) =>
        doc(email, {
          email,
          org_id: ORG_A,
          role,
          manager_email: manager,
          status: email.startsWith("inv") ? "invited" : "active",
        }),
      ),
      doc("b.owner@bb.test", {
        email: "b.owner@bb.test",
        org_id: ORG_B,
        role: "owner",
        manager_email: null,
        status: "active",
      }),
    ],
  };
}

function contracts(): SourceDoc[] {
  const base = (owner: string | null, by: string) => ({
    owner_email: owner,
    created_by: by,
    created_at: "2026-01-02T03:04:05+00:00",
  });
  return [
    doc(
      "c1",
      A({
        ...base("m1@annam.test", "m1@annam.test"),
        kind: "contract",
        title: "Cung cấp thịt heo",
        status: "active",
        direction: "purchase",
        fields: fields({
          number: "PORK-2026",
          supplier_name: "Bình An",
          supplier_tax_id: "0999000011",
          buyer_name: "An Nam",
          total_value: 588_000_000,
          end_date: "2026-12-31",
          type: "purchase",
        }),
        items: [
          {
            name: "Thịt heo",
            unit: "kg",
            qty: 6000,
            unit_price: 98_000,
            vat_rate: 8,
            quote: "6.000 kg × 98.000",
            verified: true,
          },
          { name: "Bao bì", unit: "cái", qty: 20000, unit_price: 1_200 },
        ],
        clauses: [{ chunk_id: "c1:0", number: "1", topic: "payment" }],
        history: [{ at: "2026-01-03", by: "m1@annam.test", field: "title" }],
      }),
    ),
    doc(
      "c2",
      A({
        ...base("e1@annam.test", "e1@annam.test"),
        kind: "contract",
        title: "Dịch vụ kế toán",
        status: "expiring",
        direction: "sale",
        fields: fields({
          number: "ACC-2026",
          buyer_name: "Bếp Việt",
          buyer_tax_id: "0999000021",
          total_value: 92_400_000,
          end_date: "2026-11-01",
        }),
        items: [{ name: "Dịch vụ kế toán", unit: "tháng", qty: 12, unit_price: 7_700_000 }],
        file: { name: "hd.pdf", mime: "application/pdf", size: 11 },
        source_md: "# HĐ kế toán",
      }),
    ),
    doc(
      "c3",
      A({
        ...base("v1@annam.test", "a.owner@annam.test"),
        kind: "contract",
        title: "VPP",
        status: "needs_review",
        fields: fields({ total_value: 54_000_000 }),
        items: [],
      }),
    ),
    doc(
      "c4",
      A({
        ...base(null, "e1@annam.test"),
        kind: "contract",
        title: "Chưa giao",
        status: "active",
        fields: fields({ total_value: 1_000 }),
      }),
    ),
    doc(
      "c5",
      A({
        ...base(null, "a.owner@annam.test"),
        kind: "addendum",
        parent_id: "c1",
        title: "Phụ lục giá",
        status: "active",
        fields: fields({ total_value: 12_000_000 }),
        items: [{ name: "Thịt heo", unit: "kg", qty: 100, unit_price: 120_000 }],
      }),
    ),
    doc("c7", {
      ...base("b.owner@bb.test", "b.owner@bb.test"),
      org_id: ORG_B,
      kind: "contract",
      title: "HĐ B",
      status: "active",
      fields: fields({ total_value: 100 }),
    }),
    doc("c-orphan", {
      ...base(null, "x@x.test"),
      org_id: null,
      kind: "contract",
      title: "Không org",
      status: "active",
      fields: {},
    }),
  ];
}

export function fixtureSnapshot(): Snapshot {
  const k = knowledge();
  return {
    docs: { ...identity(), contracts: contracts(), ...cks(), ...ledger(), ...staged(), ...k.docs },
    graph: k.graph,
  };
}

/** Reader bộ nhớ: lô `batch` theo thứ tự; index không có ⇒ không lô (như 404). */
export function fakeReader(s: Snapshot): SourceReader {
  return {
    async *scan(index, batch) {
      const all = s.docs[index] ?? [];
      for (let i = 0; i < all.length; i += batch) yield all.slice(i, i + batch);
    },
    count: async (index) => (s.docs[index] ?? []).length,
    async *graph(q, batch) {
      const all = s.graph[q] ?? [];
      for (let i = 0; i < all.length; i += batch) yield all.slice(i, i + batch);
    },
  };
}

/** Tổng tiền mong đợi của org A (tính tay từ fixture — đối soát phải khớp tuyệt đối). */
export const EXPECT_A = {
  "contracts.total_value": 588_000_000n + 92_400_000n + 54_000_000n + 1_000n + 12_000_000n,
  "items.unit_price": 98_000n + 1_200n + 7_700_000n + 120_000n,
  "obligations.amount": 196_000_000n + 92_500_000n,
  "partner_events.amount": 92_500_000n,
  "cks_lots.qty_x_unit_cost": 11_500_000n,
  "cks_certificates.sale_price": 3_300_000n,
  "cks_renewals.price_each": 1_700_000n,
  "cks_market_prices.price_ex_vat": 1_200_000n + 1_900_000n,
} as const;
