// fix-purchase-timer · `withEsignSigner` (THUẦN): bước gửi ký của mẫu mua hàng nhận «Ký qua» = nhà cung cấp seed bật cho công ty (Ký thử),
// KHÔNG «upload» (bước chờ tải lên hẹn hạn 7 ngày ⇒ e2e mua hàng kẹt `waiting_timer`); không ghi đè giá trị đã có.
import { describe, expect, it } from "bun:test";
import { DEMO_ESIGN_PROVIDER, withEsignSigner } from "./seed.cr125-config";

type S = { executor?: { tool_key?: string; args?: Record<string, { value?: unknown }> } };
const send = (
  args: S["executor"] extends infer E ? (E extends { args?: infer A } ? A : never) : never,
) => ({ executor: { kind: "tool", tool_key: "contracts-esign-send", args } }) as S;

describe("withEsignSigner", () => {
  it("thiếu provider + người ký ⇒ provider = Ký thử, người ký = nhóm", () => {
    const [s] = withEsignSigner([send({ contract_id: { value: "x" } })], "g1") as S[];
    expect(s?.executor?.args?.provider?.value).toBe(DEMO_ESIGN_PROVIDER);
    expect(DEMO_ESIGN_PROVIDER).toBe("selfsign");
    expect(s?.executor?.args?.company_signers?.value).toBe("group:g1");
  });
  it("đã có provider ⇒ giữ nguyên provider", () => {
    const [s] = withEsignSigner([send({ provider: { value: "upload" } })], "g1") as S[];
    expect(s?.executor?.args?.provider?.value).toBe("upload");
  });
  it("đủ provider + người ký ⇒ giữ nguyên; bước khác không đổi", () => {
    const full = send({ provider: { value: "upload" }, company_signers: { value: "user:u" } });
    const other = { executor: { tool_key: "other" } };
    const out = withEsignSigner([full, other], "g1");
    expect(out[0]).toBe(full);
    expect(out[1]).toBe(other);
  });
});
