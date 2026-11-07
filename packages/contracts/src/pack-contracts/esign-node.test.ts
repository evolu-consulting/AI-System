// CR-122 · E5 · cấu hình node Ký số: logic ⇄ args (giá trị đơn), kiểm giới hạn, hạn ký ⇒ giờ chờ.
import { describe, expect, it } from "bun:test";
import {
  decodeEsignNodeArgs,
  ESIGN_NODE_PARAMS,
  EsignNodeConfigSchema,
  encodeEsignNodeArgs,
  esignWaitTimeoutH,
} from "./esign-node";

const U = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";

describe("E5 · EsignNodeConfig", () => {
  it("rỗng ⇒ hợp lệ (mọi trường lấy cài đặt app)", () => {
    expect(EsignNodeConfigSchema.safeParse({}).success).toBe(true);
    expect(decodeEsignNodeArgs({ contract_id: U })).toEqual({ ok: true, config: {} });
  });

  it("logic ⇄ args: round-trip, args chỉ giá trị đơn", () => {
    const c = {
      company_signers: [
        { kind: "user" as const, id: U },
        { kind: "group" as const, id: G },
      ],
      partner_signs: true,
      order: "parallel" as const,
      due_days: 5,
      remind_every_hours: 24,
    };
    const args = encodeEsignNodeArgs(c);
    expect(
      Object.values(args).every((v) => ["string", "number", "boolean"].includes(typeof v)),
    ).toBe(true);
    expect(Object.keys(args).sort()).toEqual([...ESIGN_NODE_PARAMS].sort());
    expect(decodeEsignNodeArgs({ ...args, contract_id: U })).toEqual({ ok: true, config: c });
  });

  it("args dạng chuỗi (từ def lưu JSON) vẫn đọc được; giá trị rỗng = vắng", () => {
    expect(
      decodeEsignNodeArgs({
        partner_signs: "false",
        due_days: "3",
        order: "sequential",
        provider: "",
      }),
    ).toEqual({ ok: true, config: { partner_signs: false, due_days: 3, order: "sequential" } });
  });

  it("sai ⇒ báo đúng khoá: Group/người sai dạng, quá trần, thứ tự lạ", () => {
    const bad = decodeEsignNodeArgs({
      company_signers: "user:abc",
      due_days: 999,
      order: "random",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.sort()).toEqual(["company_signers", "due_days", "order"]);
    const four = [U, U, U, U].map((id) => `user:${id}`).join(",");
    expect(decodeEsignNodeArgs({ company_signers: four }).ok).toBe(false); // ≤ 3 người ký công ty
  });

  it("CR-125 m4 · provider cũ bị bỏ qua (def đã lưu vẫn chạy, mã hoá không ghi lại)", () => {
    expect(decodeEsignNodeArgs({ provider: "docusign", due_days: 2 })).toEqual({
      ok: true,
      config: { due_days: 2 },
    });
    expect(decodeEsignNodeArgs({ provider: "Bad Key!" }).ok).toBe(true);
    expect(ESIGN_NODE_PARAMS).not.toContain("provider");
    expect("provider" in encodeEsignNodeArgs({ due_days: 2 })).toBe(false);
  });

  it("hạn ký ⇒ giờ chờ của stage chờ ký", () => {
    expect(esignWaitTimeoutH({ due_days: 7 })).toBe(168);
    expect(esignWaitTimeoutH({})).toBeNull();
  });
});
