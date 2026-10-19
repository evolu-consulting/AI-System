// I1 · phần CKS, sổ, vùng chờ, tri thức + đồ thị của nguồn mgmt-app GIẢ (dữ liệu bịa).
import type {
  Snapshot,
  SourceDoc,
} from "../../../../apps/admin-api/src/modules/mgmt-import/domain/context";
import { A, doc, ORG_A, SHA1, SHA2 } from "./fixture-base";

export function cks(): Record<string, SourceDoc[]> {
  const BV = `${ORG_A}|tax:0999000021`;
  return {
    companies: [
      doc(`${ORG_A}|tax:0999000011`, A({ name: "Bình An", tax_id: "0999000011" })),
      doc(BV, A({ name: "Bếp Việt", tax_id: "0999000021" })),
      doc(`${ORG_A}|name:dong nai`, A({ name: "Đồng Nai", tax_id: null })),
    ],
    cks_lots: [
      doc(
        "l1",
        A({
          label: "2025-10",
          ca: "VNPT-CA",
          qty: 10,
          unit_cost: 1_150_000,
          years: 1,
          device: "token",
          bought_at: "2025-10-01",
          purchase_contract_id: "c1",
        }),
      ),
    ],
    cks_certificates: [
      doc(
        "k1",
        A({
          company_id: BV,
          serial: "5401 0B72 33AF 9E10",
          ca: "VNPT-CA",
          holder_name: "Chữ ký công ty",
          valid_to: "2026-10-29",
          source: "ours",
          lot_id: "l1",
          sale_contract_id: "c2",
          sale_price: 1_650_000,
          status: "active",
        }),
      ),
      doc(
        "k2",
        A({
          company_id: BV,
          serial: "5401 0B72 33AF 9E11",
          ca: "VNPT-CA",
          holder_name: "Lê Văn Tâm",
          device: "remote",
          valid_to: "2026-10-29",
          source: "ours",
          lot_id: "l1",
          sale_contract_id: "c2",
          sale_price: 1_650_000,
          status: "active",
        }),
      ),
      doc(
        "k3",
        A({
          company_id: `${ORG_A}|name:dong nai`,
          serial: "FP9 1234",
          ca: "FPT-CA",
          holder_name: "Chữ ký",
          valid_to: "2026-11-04",
          source: "elsewhere",
          status: "active",
          created_by: "e1@annam.test",
        }),
      ),
    ],
    cks_renewals: [
      doc(
        "r1",
        A({
          sale_contract_id: "c2",
          company_id: BV,
          certificate_ids: ["k1", "k2"],
          status: "open",
          new_contract_id: "c3",
          price_each: 1_700_000,
          valid_to: "2027-10-29",
          by: "e1@annam.test",
        }),
      ),
    ],
    signed_docs: [
      doc(
        "s1",
        A({
          company_id: BV,
          certificate_id: "k1",
          serial: "54010B7233AF9E10",
          kind: "invoice",
          number: "1245",
          title: "HĐ 1245",
          signed_at: "2026-09-01",
          filename: "hd-1245.xml",
          source: "xml",
          sha256: SHA1,
          by: "e1@annam.test",
        }),
      ),
      doc(
        "s2",
        A({
          company_id: BV,
          serial: "54010B7233AF9E11",
          kind: "contract",
          title: "HĐ ký",
          filename: "x.pdf",
          source: "pdf",
          sha256: SHA1,
          by: "e1@annam.test",
        }),
      ),
      doc(
        "s3",
        A({
          company_id: BV,
          certificate_id: "k1",
          serial: "54010B7233AF9E10",
          kind: "invoice",
          title: "trùng",
          filename: "hd-1245b.xml",
          source: "xml",
          sha256: SHA1,
          by: "e1@annam.test",
        }),
      ),
    ],
    market_observations: [
      doc("o-shared", {
        org_id: "*",
        product_kind: "cks",
        ca: "viettel",
        ca_name: "Viettel-CA",
        years: 1,
        kind: "new",
        device: "token",
        seller: "Viettel",
        tier: "official",
        price_ex_vat: 1_200_000,
        seen: "2026-09-30",
        verified: true,
      }),
      doc(
        "o-a",
        A({
          product_kind: "cks",
          ca: "vnpt",
          years: 2,
          kind: "renew",
          seller: "Đại lý X",
          price_ex_vat: 1_900_000,
          seen: "2026-10-01",
          source: "ai_scan",
        }),
      ),
      doc("o-goods", A({ product_kind: "goods", product: "x", price: 5 })),
    ],
  };
}

export function ledger(): Record<string, SourceDoc[]> {
  const BV = `${ORG_A}|tax:0999000021`;
  const BA = `${ORG_A}|tax:0999000011`;
  return {
    obligations: [
      doc(
        "o1",
        A({
          contract_id: "c1",
          company_id: BA,
          direction: "pay",
          kind: "payment",
          seq: 1,
          due_date: "2026-09-10",
          amount: 196_000_000,
          status: "done",
          done_at: "2026-09-10",
          done_by: "m1@annam.test",
          source: "ai",
        }),
      ),
      doc(
        "o2",
        A({
          contract_id: "c2",
          company_id: BV,
          direction: "receive",
          kind: "payment",
          seq: 1,
          due_date: "2026-10-20",
          amount: 92_500_000,
          status: "open",
          source: "seed",
          postpones: 1,
          postponed_to: "2026-10-25",
        }),
      ),
    ],
    partner_events: [
      doc(
        "pe1",
        A({
          company_id: BV,
          role: "customer",
          type: "received",
          at: "2026-09-01",
          by: "e1@annam.test",
          source: "seed",
          contract_id: "c2",
          obligation_id: "o2",
          days_late: 0,
          amount: 92_500_000,
        }),
      ),
      doc(
        "pe2",
        A({
          company_id: BA,
          role: "supplier",
          type: "delivered",
          at: "2026-09-02",
          by: "hệ thống",
          source: "system",
          days_late: 1,
        }),
      ),
      doc(
        "pe3",
        A({
          company_id: BA,
          role: "supplier",
          type: "complaint",
          at: "2026-09-03",
          by: "m1@annam.test",
          source: "action",
          note: "rau dập",
          voided: true,
          voided_by: "a.owner@annam.test",
          voided_at: "2026-09-04T01:00:00+00:00",
        }),
      ),
      doc(
        "pe4",
        A({
          company_id: BV,
          role: "customer",
          type: "rating",
          at: "2026-09-05",
          by: "a.owner@annam.test",
          source: "rating",
          criterion: "custom:x",
          value: 80,
        }),
      ),
    ],
    followups: [
      doc(
        "f1",
        A({
          user_email: "e1@annam.test",
          subject_kind: "renewal",
          subject_id: "r1",
          at: "2026-10-25T09:00:00+07:00",
          title: "Gọi Bếp Việt",
          status: "pending",
          created_at: "2026-10-01T00:00:00+00:00",
        }),
      ),
      doc(
        "f2",
        A({
          user_email: "e1@annam.test",
          subject_kind: "obligation",
          subject_id: "o2",
          at: "2026-10-26T09:00:00+07:00",
          title: "Đòi tiền",
          status: "pending",
        }),
      ),
    ],
  };
}

export function staged(): Record<string, SourceDoc[]> {
  return {
    notifications: [
      doc("n1", {
        user_email: "e1@annam.test",
        contract_id: "c2",
        milestone: 30,
        title: "Sắp hết hạn",
        body: "…",
      }),
    ],
    quotes: [
      doc(
        "q1",
        A({ product: `${ORG_A}|name:thit heo|`, supplier_name: "Hưng Phát", price: 94_500 }),
      ),
    ],
    feedback: [doc("fb1", A({ by: "e1@annam.test", kind: "đề xuất", description: "Thêm nút" }))],
    chats: [
      doc(
        "ch1",
        A({
          user_email: "e1@annam.test",
          title: "Hỏi",
          messages: [{ role: "user", content: "x\u0000y" }],
        }),
      ),
      doc("ch-internal", { org_id: null, user_email: "staff@internal.test", messages: [] }),
    ],
    score_configs: [doc(`${ORG_A}:customer`, A({ role: "customer", version: 2, criteria: [] }))],
    catalogs: [
      doc(
        ORG_A,
        A({
          categories: [
            { id: "food-x", name: "Thực phẩm" },
            { id: "sup-x", name: "Vật tư" },
          ],
          assign: [
            { product: `${ORG_A}|name:thit heo|`, category: "food-x" },
            { product: `${ORG_A}|name:bao bi|`, category: "sup-x" },
          ],
        }),
      ),
    ],
    state: [
      doc("remind:c2:2026-10-02:30:e1@annam.test", {
        value: { at: "2026-10-02T01:00:00+00:00", sent: ["email"] },
      }),
      doc("remind:c2:price-2026-01-01:0:e1@annam.test", { value: { at: "2026-01-01T00:00:00Z" } }),
      doc("remind:last_run", { value: { date: "2026-10-19" } }),
    ],
  };
}

export function knowledge(): Pick<Snapshot, "graph"> & { docs: Record<string, SourceDoc[]> } {
  return {
    docs: {
      documents: [
        doc("d-gen", {
          source_type: "upload",
          title: "Quy trình",
          uri: "upload://qt.md",
          content_hash: SHA1,
          domain: "general",
        }),
        doc("c2", {
          source_type: "upload",
          title: "hd.pdf",
          uri: "upload://hd.pdf",
          content_hash: SHA2,
          domain: "contract",
        }),
        doc("d-dup", {
          source_type: "upload",
          title: "Bản trùng",
          uri: "upload://qt2.md",
          content_hash: SHA1,
          domain: "general",
        }),
      ],
      chunks: [
        doc("d-gen:0", { doc_id: "d-gen", chunk_index: 0, text: "An dẫn dự án Apollo." }),
        doc("d-gen:1", { doc_id: "d-gen", chunk_index: 1, text: "An báo cáo hằng tuần." }),
        doc("c2:0", {
          doc_id: "c2",
          chunk_index: 0,
          text: "Điều 5. Thanh toán.",
          domain: "contract",
          contract_id: "c2",
          clause_no: "5",
          heading: "Thanh toán",
        }),
      ],
    },
    graph: {
      entities: [
        ["Person:an", "An", "Person"],
        ["Project:apollo", "Apollo", "Project"],
      ],
      mentions: [
        ["d-gen:0", "Person:an"],
        ["d-gen:0", "Project:apollo"],
        ["d-gen:1", "Person:an"],
      ],
      rels: [["Person:an", "Project:apollo", "LEADS", "d-gen:0"]],
      aliases: [],
      chunk_links: [["d-gen:0", "d-gen:1", "SIMILAR", 0.91, null]],
      doc_links: [["d-gen", "c2"]],
      doc_chunks: [],
      contract_graph: [],
    },
  };
}
