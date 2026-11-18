// CR-122 · E5 · cấu hình node Ký số: logic ⇄ args (giá trị đơn), kiểm giới hạn, hạn ký ⇒ giờ chờ.
import { describe, expect, it } from "bun:test";
import {
  decodeEsignNodeArgs,
  ESIGN_NODE_PARAMS,
  ESIGN_NODE_UPLOAD,
  EsignNodeConfigSchema,
  encodeEsignNodeArgs,
  esignConfigIssues,
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
      provider: "docusign",
      signer_role: "nguoi-ky-hop-dong", // CR-182
      signer_role_label: "Người ký hợp đồng",
      need_digital: true,
      partner_signs: true,
      order: "parallel" as const,
      due_days: 5,
      due_hours: 12,
      remind_every_hours: 24,
    };
    const args = encodeEsignNodeArgs(c);
    expect(
      Object.values(args).every((v) => ["string", "number", "boolean"].includes(typeof v)),
    ).toBe(true);
    expect(Object.keys(args).sort()).toEqual([...ESIGN_NODE_PARAMS].sort());
    expect(decodeEsignNodeArgs({ ...args, contract_id: U })).toEqual({ ok: true, config: c });
  });

  it("CR-182 · vai người ký thay cho người ký cố định, need_digital=false không ghi ra args", () => {
    expect(esignConfigIssues({ provider: "ondoc", signer_role: "nguoi-ky-hop-dong" })).toEqual([]);
    expect(esignConfigIssues({ signer_role: "nguoi-ky-hop-dong" })).toEqual([]); // vai đủ, không cần «Ký qua»
    expect(esignConfigIssues({ provider: "ondoc" }).map((i) => i.code)).toEqual([
      "NO_SIGNER_SELECTED",
    ]);
    expect(encodeEsignNodeArgs({ signer_role: "a-b", need_digital: false })).toEqual({
      signer_role: "a-b",
    });
    expect(EsignNodeConfigSchema.safeParse({ signer_role: "Có Dấu" }).success).toBe(false);
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

  it("CR-146b · «Ký qua» (provider) đọc/ghi được; khoá sai dạng ⇒ lỗi theo khoá", () => {
    expect(decodeEsignNodeArgs({ provider: "docusign", due_days: 2 })).toEqual({
      ok: true,
      config: { provider: "docusign", due_days: 2 },
    });
    expect(decodeEsignNodeArgs({ provider: ESIGN_NODE_UPLOAD }).ok).toBe(true);
    expect(decodeEsignNodeArgs({ provider: "Bad Key!" })).toEqual({
      ok: false,
      issues: ["provider"],
    });
    expect(ESIGN_NODE_PARAMS).toContain("provider");
    expect(encodeEsignNodeArgs({ provider: "selfsign" }).provider).toBe("selfsign");
  });

  it("CR-146b · thiếu «Ký qua» hoặc người ký ⇒ lỗi theo trường; đủ ⇒ hợp lệ", () => {
    expect(esignConfigIssues({})).toEqual([
      { field: "provider", code: "NO_PROVIDER_SELECTED" },
      { field: "company_signers", code: "NO_SIGNER_SELECTED" },
    ]);
    expect(esignConfigIssues({ provider: "upload" })).toEqual([
      { field: "company_signers", code: "NO_SIGNER_SELECTED" },
    ]);
    expect(
      esignConfigIssues({ provider: "upload", company_signers: [{ kind: "group", id: G }] }),
    ).toEqual([]);
  });

  it("hạn ký ⇒ giờ chờ của stage chờ ký", () => {
    expect(esignWaitTimeoutH({ due_days: 7 })).toBe(168);
    expect(esignWaitTimeoutH({})).toBeNull();
  });

  it("due_hours: hạn 4 giờ ⇒ lượt chờ hết hạn sau 4 giờ; thắng due_days; args round-trip; ngoài trần ⇒ lỗi", () => {
    expect(esignWaitTimeoutH({ due_hours: 4 })).toBe(4);
    expect(esignWaitTimeoutH({ due_hours: 4, due_days: 7 })).toBe(4);
    expect(decodeEsignNodeArgs({ due_hours: "4" })).toEqual({
      ok: true,
      config: { due_hours: 4 },
    });
    expect(encodeEsignNodeArgs({ due_hours: 4 })).toEqual({ due_hours: 4 });
    expect(decodeEsignNodeArgs({ due_hours: "99999" }).ok).toBe(false);
  });
});

describe("CR-182 · signer_role_label", () => {
  it("encode và decode giữ nhãn vai mới, nhãn quá 80 ký tự bị từ chối", () => {
    const args = encodeEsignNodeArgs({ signer_role: "giam-doc", signer_role_label: "Giám đốc" });
    expect(args).toEqual({ signer_role: "giam-doc", signer_role_label: "Giám đốc" });
    expect(decodeEsignNodeArgs(args)).toEqual({
      ok: true,
      config: { signer_role: "giam-doc", signer_role_label: "Giám đốc" },
    });
    expect(encodeEsignNodeArgs({ signer_role: "a" })).toEqual({ signer_role: "a" });
    expect(EsignNodeConfigSchema.safeParse({ signer_role_label: "x".repeat(81) }).success).toBe(
      false,
    );
  });
});
