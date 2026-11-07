// CR-120 · tool gói của khe `contracts.intake` với repo giả: đọc trạng thái trích, gửi ký (người ký công ty + đối tác theo email liên hệ),
// nhắc nghĩa vụ idempotent; HĐ không thấy ⇒ ném (stage tool_failed); mã HĐ sai dạng ⇒ ném trước mọi SQL.
import { describe, expect, it } from "bun:test";
import type { PackToolCtx } from "../../kit/application/pack-tools.ports";
import { INTAKE_TOOL_KEYS, intakeTools } from "./intake.tools";

const ID = "11111111-1111-4111-8111-111111111111";
const SIGNER = { company_signers: "user:u1" }; // CEO-review #2: Ký số phải chọn người ký công ty (không còn «người bắt đầu» ngầm)
const CTX: PackToolCtx = { tenantId: "t1", userId: "u1", runId: null };

function make(o: {
  src?: { status: string } | null;
  contract?: {
    number: string | null;
    title: string;
    partner: { name: string | null; email: string | null } | null;
  } | null;
  enqueued?: number;
}) {
  const log: { sent: unknown[]; notify: unknown[]; reads: number } = {
    sent: [],
    notify: [],
    reads: 0,
  };
  const repos = {
    extraction: { source: async () => (log.reads++, o.src ?? null) },
    esign: {
      contract: async () => (log.reads++, o.contract ?? null),
      lockForSign: async () => {},
    },
    notify: {
      enqueue: async (rows: unknown[]) => {
        log.notify.push(...rows);
        return o.enqueued ?? 1;
      },
    },
  };
  const tools = intakeTools({
    uow: { tenant: async (_w, fn) => fn(repos as never) },
    send: async (...a) => void log.sent.push(a),
    nodeSigners: async (_t, entries) => entries.map((e) => e.id),
    parsePartner: (name, email) => (email.includes("@") ? { name, email } : null),
  });
  const tool = (k: string) => tools.find((t) => t.name === k) as (typeof tools)[number];
  return { log, tool };
}

describe("CR-120 · intakeTools", () => {
  it("3 tool, khoá cố định; chỉ tool gửi ký có side_effect", () => {
    const { tool } = make({});
    expect(Object.values(INTAKE_TOOL_KEYS).map((k) => [k, tool(k).side_effect])).toEqual([
      ["contracts-extract", false],
      ["contracts-esign-send", true],
      ["contracts-obligation-remind", false],
    ]);
  });

  it("contracts-extract: trả trạng thái; HĐ không thấy ⇒ CONTRACT_NOT_FOUND; id sai dạng ⇒ ném, 0 đọc", async () => {
    const a = make({ src: { status: "needs_review" } });
    expect(await a.tool("contracts-extract").run(CTX, { contract_id: ID })).toEqual({
      status: "needs_review",
    });
    const b = make({ src: null });
    await expect(b.tool("contracts-extract").run(CTX, { contract_id: ID })).rejects.toThrow(
      "CONTRACT_NOT_FOUND",
    );
    await expect(b.tool("contracts-extract").run(CTX, { contract_id: "x" })).rejects.toThrow(
      "CONTRACT_ID_INVALID",
    );
    expect(b.log.reads).toBe(1);
  });

  it("contracts-esign-send: có email đối tác ⇒ [company, partner]; không email ⇒ [company]; người ký công ty = người được chọn", async () => {
    const withP = make({
      contract: { number: "S1", title: "HĐ", partner: { name: "Đối tác A", email: "a@x.vn" } },
    });
    expect(
      await withP.tool("contracts-esign-send").run(CTX, { contract_id: ID, ...SIGNER }),
    ).toEqual({
      status: "sent",
    });
    expect(withP.log.sent).toEqual([
      [
        "t1",
        "u1",
        ID,
        [{ role: "company" }, { role: "partner", name: "Đối tác A", email: "a@x.vn" }],
        undefined,
        { companyUsers: ["u1"] },
      ],
    ]);
    const noP = make({
      contract: { number: null, title: "HĐ", partner: { name: "B", email: null } },
    });
    await noP.tool("contracts-esign-send").run(CTX, { contract_id: ID, ...SIGNER });
    expect(noP.log.sent).toEqual([
      ["t1", "u1", ID, [{ role: "company" }], undefined, { companyUsers: ["u1"] }],
    ]);
  });

  it("contracts-obligation-remind: chuông cho người bắt đầu, dedup theo HĐ; trùng ⇒ already", async () => {
    const a = make({ contract: { number: "S1", title: "HĐ", partner: null } });
    expect(await a.tool("contracts-obligation-remind").run(CTX, { contract_id: ID })).toEqual({
      status: "notified",
    });
    expect(a.log.notify).toMatchObject([
      { user_id: "u1", kind: "contract.obligation", dedup_key: `intake-remind:${ID}` },
    ]);
    const b = make({ contract: { number: "S1", title: "HĐ", partner: null }, enqueued: 0 });
    expect(await b.tool("contracts-obligation-remind").run(CTX, { contract_id: ID })).toEqual({
      status: "already",
    });
  });
});
