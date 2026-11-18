// CR-122 · E5 · tool `contracts-esign-send` đọc cấu hình node từ `args` (repo/nhà gửi giả): args ghi đè, trống ⇒ như trước (4 tham số).
import { describe, expect, it } from "bun:test";
import { ESIGN_NODE_PARAMS } from "@ai/contracts/pack-contracts";
import type { PackToolCtx } from "../../kit/application/pack-tools.ports";
import { ESignFail } from "../application/esign.usecase";
import { INTAKE_TOOL_KEYS, intakeTools } from "./intake.tools";

const ID = "11111111-1111-4111-8111-111111111111";
const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const G1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CTX: PackToolCtx = { tenantId: "t1", userId: "u1", runId: null };

function make(email: string | null = "p@x.vn", sendErr?: Error, onDoc?: boolean) {
  const waits: unknown[][] = [];
  const sent: unknown[][] = [];
  const asked: unknown[] = [];
  const repos = {
    extraction: { source: async () => null },
    esign: {
      lockForSign: async () => {},
      openSignWait: async (...a: unknown[]) => void waits.push(a),
      latest: async () => null,
      contract: async () => ({ number: "S1", title: "HĐ", partner: { name: "Đối tác", email } }),
    },
    notify: { enqueue: async () => 1 },
  };
  const tools = intakeTools({
    uow: { tenant: async (_w, fn) => fn(repos as never) },
    send: async (...a) => {
      if (sendErr) throw sendErr;
      sent.push(a);
    },
    // Group G1 ⇒ hai thành viên; người cụ thể ⇒ chính nó.
    nodeSigners: async (_t, entries) => {
      asked.push(entries);
      return entries.flatMap((e) => (e.kind === "group" ? [U1, U2] : [e.id]));
    },
    parsePartner: (name, e) => (e.includes("@") ? { name, email: e } : null),
    ...(onDoc === undefined ? {} : { onDocEnabled: async () => onDoc }),
  });
  const send = tools.find((t) => t.name === INTAKE_TOOL_KEYS.esignSend) as (typeof tools)[number];
  return { send, sent, asked, waits };
}

describe("E5 · tool Ký số theo args của node", () => {
  it("khai đủ tham số cấu hình (tuỳ chọn) để lưu def cho phép args", () => {
    const { send } = make();
    const names = send.params.map((p) => p.name);
    for (const k of ESIGN_NODE_PARAMS) expect(names).toContain(k);
    expect(send.params.filter((p) => p.required).map((p) => p.name)).toEqual(["contract_id"]);
    expect(names).toContain("provider");
  });

  it("CEO-review #2 · không chọn người ký công ty ⇒ lỗi nghiệp vụ ESIGN_NODE_NO_SIGNER, không gửi", async () => {
    const { send, sent, asked } = make();
    await expect(send.run(CTX, { contract_id: ID, provider: "docusign" })).rejects.toThrow(
      "ESIGN_NODE_NO_SIGNER",
    );
    expect(sent).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("CR-146b · không chọn «Ký qua» ⇒ lỗi nghiệp vụ, không gửi, không mặc định cấp công ty", async () => {
    const { send, sent } = make();
    await expect(send.run(CTX, { contract_id: ID, company_signers: `user:${U1}` })).rejects.toThrow(
      "ESIGN_NODE_CONFIG_INVALID:provider",
    );
    expect(sent).toEqual([]);
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

  it("partner_signs=false ⇒ chỉ công ty ký (dù có email), =true mà thiếu email ⇒ lỗi", async () => {
    const a = make();
    await a.send.run(CTX, {
      contract_id: ID,
      provider: "selfsign",
      partner_signs: false,
      order: "sequential",
      company_signers: `user:${U1}`,
    });
    expect(a.sent[0]?.[3]).toEqual([{ role: "company" }]);
    const b = make(null);
    await expect(
      b.send.run(CTX, {
        contract_id: ID,
        provider: "selfsign",
        partner_signs: true,
        company_signers: `user:${U1}`,
      }),
    ).rejects.toThrow("NO_PARTNER_EMAIL");
    expect(b.sent).toEqual([]);
  });

  it("cấu hình sai ⇒ lỗi rõ theo khoá, không gửi", async () => {
    const { send, sent } = make();
    await expect(
      send.run(CTX, {
        contract_id: ID,
        provider: "selfsign",
        order: "random",
        company_signers: `user:${U1}`,
      }),
    ).rejects.toThrow("ESIGN_NODE_CONFIG_INVALID:order");
    expect(sent).toEqual([]);
  });
});

describe("CR-181 · «Ký qua» = ondoc khi công ty TẮT ký trên tài liệu", () => {
  it("tắt ⇒ lỗi nghiệp vụ ONDOC_NOT_ENABLED (không treo câm, không ghi người được giao, không gửi ký), bật ⇒ chờ ký trên tài liệu", async () => {
    const off = make("p@x.vn", undefined, false);
    await expect(
      off.send.run(CTX, { contract_id: ID, provider: "ondoc", company_signers: `user:${U1}` }),
    ).rejects.toThrow("ONDOC_NOT_ENABLED");
    expect([off.waits, off.sent]).toEqual([[], []]);
    const on = make("p@x.vn", undefined, true);
    expect(
      await on.send.run(CTX, { contract_id: ID, provider: "ondoc", company_signers: `user:${U1}` }),
    ).toEqual({ status: "awaiting_ondoc" });
  });
});

describe("CR-146b · «Ký qua» của node", () => {
  it("upload ⇒ không gửi ký số, chờ tải lên, người được giao = người ký đã chọn", async () => {
    const u = make();
    expect(
      await u.send.run(CTX, {
        contract_id: ID,
        provider: "upload",
        company_signers: `group:${G1}`,
      }),
    ).toEqual({ status: "awaiting_upload" });
    expect(u.sent).toEqual([]);
    expect(u.waits[0]?.[1]).toEqual([U1, U2]);
  });
  it("nhà cung cấp mà công ty đã tắt ký số ⇒ ESIGN_DISABLED (lỗi rõ, KHÔNG tự chờ tải lên), lỗi khác vẫn ném", async () => {
    const off = make("p@x.vn", new ESignFail("ESIGN_DISABLED", "disabled"));
    await expect(
      off.send.run(CTX, { contract_id: ID, provider: "docusign", company_signers: `user:${U1}` }),
    ).rejects.toMatchObject({ code: "ESIGN_DISABLED" });
    expect(off.sent).toEqual([]);
    const boom = make("p@x.vn", new Error("boom"));
    await expect(
      boom.send.run(CTX, { contract_id: ID, provider: "docusign", company_signers: `user:${U1}` }),
    ).rejects.toBeDefined();
  });
});

describe("CR-182 · bước Ký có vai (signer_role) theo công tắc lùi on_doc_enabled", () => {
  const role = { signer_role: "nguoi-ky-hop-dong" };
  it("công ty BẬT ⇒ ký trên tài liệu với người ký giải từ vai, BỎ provider cũ (kể cả docusign / trống)", async () => {
    for (const legacy of [{ provider: "docusign" }, {}] as Record<string, string>[]) {
      const on = make("p@x.vn", undefined, true);
      const r = await on.send.run(CTX, {
        contract_id: ID,
        ...role,
        ...legacy,
        company_signers: `group:${G1}`,
      });
      expect(r).toEqual({ status: "awaiting_ondoc" });
      expect(on.sent).toEqual([]);
      expect(on.waits[0]?.[1]).toEqual([U1, U2]);
    }
  });
  it("công ty TẮT ⇒ chạy như cũ: gửi qua provider cũ, thiếu provider ⇒ ESIGN_NODE_CONFIG_INVALID:provider, provider ondoc ⇒ ONDOC_NOT_ENABLED", async () => {
    const off = make("p@x.vn", undefined, false);
    await off.send.run(CTX, {
      contract_id: ID,
      ...role,
      provider: "docusign",
      company_signers: `user:${U1}`,
    });
    expect(off.sent.length).toBe(1);
    await expect(
      off.send.run(CTX, { contract_id: ID, ...role, company_signers: `user:${U1}` }),
    ).rejects.toThrow("ESIGN_NODE_CONFIG_INVALID:provider");
    await expect(
      off.send.run(CTX, {
        contract_id: ID,
        ...role,
        provider: "ondoc",
        company_signers: `user:${U1}`,
      }),
    ).rejects.toThrow("ONDOC_NOT_ENABLED");
  });
  it("vai chưa giao (không có company_signers) ⇒ ESIGN_NODE_NO_SIGNER ở cả hai chế độ, không lùi về người bắt đầu lượt", async () => {
    for (const onDoc of [true, false]) {
      const m = make("p@x.vn", undefined, onDoc);
      await expect(
        m.send.run(CTX, { contract_id: ID, ...role, provider: "upload" }),
      ).rejects.toThrow("ESIGN_NODE_NO_SIGNER");
      expect([m.waits, m.sent]).toEqual([[], []]);
    }
  });
});
