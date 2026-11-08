// CR-125 · S3 · C3 · điền sẵn người ký từ nhóm duyệt khi sao chép Thư viện.
import { describe, expect, test } from "bun:test";
import { firstApprovalGroupId, prefillEsignSigner } from "./esign-signer-prefill.rules";

const GID = "11111111-1111-4111-8111-111111111111";
const approve = { key: "a", after: { group_id: GID } };
const esign = (args: Record<string, unknown>) => ({
  key: "ky-so",
  executor: { kind: "tool", tool_key: "contracts-esign-send", args },
});

describe("prefillEsignSigner", () => {
  test("ô người ký trống ⇒ điền nhóm duyệt đầu tiên, giữ args khác", () => {
    const out = prefillEsignSigner([approve, esign({ contract_id: "x" })]) as {
      executor: { args: Record<string, unknown> };
    }[];
    expect(out[1]?.executor.args).toEqual({
      contract_id: "x",
      company_signers: { from: "const", value: `group:${GID}` },
    });
  });
  test("đã có người ký ⇒ giữ nguyên", () => {
    const e = esign({ company_signers: { from: "const", value: "user:abc" } });
    expect(prefillEsignSigner([approve, e])[1]).toBe(e);
  });
  test("không có nhóm duyệt ⇒ để trống", () => {
    const e = esign({});
    expect(prefillEsignSigner([{ key: "a", after: { group_id: null } }, e])[1]).toBe(e);
    expect(firstApprovalGroupId([e])).toBeNull();
  });
});
