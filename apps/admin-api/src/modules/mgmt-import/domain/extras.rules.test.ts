// niti-import2 · luật thuần phần còn lại: lọc org/[E2E], chat ⇒ hội thoại lưu trữ (giờ tin tăng ngặt, file gắn đúng lượt, file thừa
// gom riêng, đuôi lạ không đính kèm), báo giá/CKS/thông báo.
import { describe, expect, test } from "bun:test";
import type { SourceDoc } from "./context";
import { foldVi, planChats, safeName } from "./extras-chat.rules";
import { planContractsExtras, productKey } from "./extras-contracts.rules";
import { keepExtras } from "./extras-scope.rules";
import { targetId } from "./ids.rules";

const ORG = "org-a";
const doc = (id: string, src: Record<string, unknown>): SourceDoc => ({
  id,
  src: { id, org_id: ORG, ...src },
});
const C = { source: "x-extras", tenantId: "t", userId: "u", now: "2026-10-01T00:00:00.000Z" };

describe("niti-import2 · extras rules", () => {
  test("keepExtras: chỉ org đích, bỏ [E2E]; thông báo theo org của HĐ; kết quả quét theo lượt được giữ", () => {
    const k = keepExtras(
      {
        chats: [doc("a", {}), { id: "b", src: { org_id: "demo" } }, doc("c", { title: "[E2E] x" })],
        notifications: [
          { id: "n", src: { _contract_org: ORG } },
          { id: "m", src: {} },
        ],
        market_scans: [doc("s1", {}), doc("s2", { note: "[E2E]" })],
        market_observations: [doc("o1", { scan_id: "s1" }), doc("o2", { scan_id: "s2" })],
      },
      ORG,
    );
    expect(k.docs.chats?.map((d) => d.id)).toEqual(["a"]);
    expect(k.excluded_other_org).toMatchObject({ chats: 1, notifications: 1 });
    expect(k.excluded_e2e).toMatchObject({ chats: 1, market_scans: 1 });
    expect(k.docs.market_observations?.map((d) => d.id)).toEqual(["o1"]);
  });

  test("planChats: tin tăng ngặt, bỏ tin rỗng, file gắn lượt nhắc tên, file thừa gom riêng, đuôi lạ không đính kèm", () => {
    const p = planChats(
      C,
      [
        doc("ch", {
          title: "Hỏi giá",
          created_at: "2026-09-01T00:00:00Z",
          messages: [
            { role: "user", content: "a", at: "2026-09-01T00:00:00Z", files: ["x.pdf"] },
            { role: "assistant", content: "b" },
            { role: "assistant", content: "" },
          ],
        }),
      ],
      [
        doc("f1", { name: "x.pdf" }),
        doc("f2", { name: "y.exe", created_at: "2026-09-02T00:00:00Z" }),
      ],
    );
    const [u, orphan] = p.units;
    expect(u?.messages.map((m) => m.created_at)).toEqual([
      "2026-09-01T00:00:00.000Z",
      "2026-09-01T00:00:00.001Z",
    ]);
    expect(u?.files.map((f) => [f.row.filename, f.row.message_id, f.row.position])).toEqual([
      ["x.pdf", targetId(C.source, "msg", "ch#0"), 0],
    ]);
    expect(u?.conv).toMatchObject({ title: "Hỏi giá", title_norm: "hoi gia" });
    expect(orphan?.orphan).toBe(true);
    expect(orphan?.files).toEqual([]);
    expect(p.unsupported).toEqual(["y.exe"]);
    expect(p.messages_skipped_empty).toBe(1);
  });

  test("foldVi / safeName / productKey", () => {
    expect(foldVi("Đơn Giá Gạo")).toBe("don gia gao");
    expect(safeName("báo giá (1).pdf")).toBe("báo giá _1_.pdf");
    expect(productKey(`${ORG}|name:gao|`, ORG)).toBe("name:gao|");
    expect(productKey("code:a1", ORG)).toBe("code:a1");
  });

  test("planContractsExtras: chứng thư nối HĐ của chủ, văn bản nối chứng thư, thông báo lịch sử", () => {
    const issues: never[] = [];
    const p = planContractsExtras(
      {
        source: "x",
        linkSource: "main",
        userId: "u",
        contracts: new Set(["c1"]),
        org: ORG,
        issues,
      },
      {
        companies: [doc(`${ORG}|tax:0101`, { name: "Bếp", tax_id: "0101" })],
        cks_certificates: [
          doc("k1", {
            company_id: `${ORG}|tax:0101`,
            valid_to: "2027-01-01",
            sale_contract_id: "c1",
          }),
        ],
        signed_docs: [
          doc("s1", { certificate_id: "k1", filename: "a.xml", sha256: "b".repeat(64) }),
        ],
        notifications: [{ id: "n1", src: { title: "T", read_at: "2026-09-01T00:00:00Z" } }],
      },
    );
    expect(p.rows.cks_certificates[0]?.sale_contract_id).toBe(targetId("main", "contract", "c1"));
    expect(p.rows.cks_signed_docs[0]?.certificate_id).toBe(targetId("x", "cert", "k1"));
    expect(p.rows.cks_customers).toEqual([
      { id: targetId("x", "company", `${ORG}|tax:0101`), name: "Bếp", tax_id: "0101" },
    ]);
    expect(p.notifications[0]).toMatchObject({
      user_id: "u",
      mgmt_id: "n1",
      read_at: "2026-09-01T00:00:00.000Z",
    });
    expect(issues).toEqual([]);
  });
});
