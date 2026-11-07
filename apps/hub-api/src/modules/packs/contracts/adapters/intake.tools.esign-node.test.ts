// CR-122 · E5 · tool `contracts-esign-send` đọc cấu hình node từ `args` (repo/nhà gửi giả): args ghi đè, trống ⇒ như trước (4 tham số).
import { describe, expect, it } from "bun:test";
import { ESIGN_NODE_PARAMS } from "@ai/contracts/pack-contracts";
import type { PackToolCtx } from "../../kit/application/pack-tools.ports";
import { INTAKE_TOOL_KEYS, intakeTools } from "./intake.tools";

const ID = "11111111-1111-4111-8111-111111111111";
const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const G1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CTX: PackToolCtx = { tenantId: "t1", userId: "u1", runId: null };

function make(email: string | null = "p@x.vn") {
  const sent: unknown[][] = [];
  const asked: unknown[] = [];
  const repos = {
    extraction: { source: async () => null },
    esign: {
      lockForSign: async () => {},
      contract: async () => ({ number: "S1", title: "HĐ", partner: { name: "Đối tác", email } }),
    },
    notify: { enqueue: async () => 1 },
  };
  const tools = intakeTools({
    uow: { tenant: async (_w, fn) => fn(repos as never) },
    send: async (...a) => void sent.push(a),
    // Group G1 ⇒ hai thành viên; người cụ thể ⇒ chính nó.
    nodeSigners: async (_t, entries) => {
      asked.push(entries);
      return entries.flatMap((e) => (e.kind === "group" ? [U1, U2] : [e.id]));
    },
    parsePartner: (name, e) => (e.includes("@") ? { name, email: e } : null),
  });
  const send = tools.find((t) => t.name === INTAKE_TOOL_KEYS.esignSend) as (typeof tools)[number];
  return { send, sent, asked };
}

describe("E5 · tool Ký số theo args của node", () => {
  it("khai đủ tham số cấu hình (tuỳ chọn) để lưu def cho phép args", () => {
    const { send } = make();
    const names = send.params.map((p) => p.name);
    for (const k of ESIGN_NODE_PARAMS) expect(names).toContain(k);
    expect(send.params.filter((p) => p.required).map((p) => p.name)).toEqual(["contract_id"]);
  });

  it("không args ⇒ đúng đường cũ: send 4 tham số, người ký = người bắt đầu", async () => {
    const { send, sent, asked } = make();
    await send.run(CTX, { contract_id: ID });
    expect(sent).toEqual([
      [
        "t1",
        "u1",
        ID,
        [{ role: "company" }, { role: "partner", name: "Đối tác", email: "p@x.vn" }],
      ],
    ]);
    expect(asked).toEqual([]);
  });

  it("args ghi đè: nhà cung cấp, thứ tự song song, Group ⇒ nhiều người ký công ty, đối tác ký", async () => {
    const { send, sent } = make();
    await send.run(CTX, {
      contract_id: ID,
      provider: "docusign",
      order: "parallel",
      company_signers: `group:${G1}`,
      partner_signs: true,
    });
    expect(sent).toEqual([
      [
        "t1",
        U1,
        ID,
        [
          { role: "company" },
          { role: "company" },
          { role: "partner", name: "Đối tác", email: "p@x.vn" },
        ],
        "docusign",
        { companyUsers: [U1, U2], order: "parallel" },
      ],
    ]);
  });

  it("partner_signs=false ⇒ chỉ công ty ký (dù có email); =true mà thiếu email ⇒ lỗi", async () => {
    const a = make();
    await a.send.run(CTX, { contract_id: ID, partner_signs: false, order: "sequential" });
    expect(a.sent[0]?.[3]).toEqual([{ role: "company" }]);
    const b = make(null);
    await expect(b.send.run(CTX, { contract_id: ID, partner_signs: true })).rejects.toThrow(
      "NO_PARTNER_EMAIL",
    );
    expect(b.sent).toEqual([]);
  });

  it("cấu hình sai ⇒ lỗi rõ theo khoá, không gửi", async () => {
    const { send, sent } = make();
    await expect(send.run(CTX, { contract_id: ID, order: "random" })).rejects.toThrow(
      "ESIGN_NODE_CONFIG_INVALID:order",
    );
    expect(sent).toEqual([]);
  });
});
