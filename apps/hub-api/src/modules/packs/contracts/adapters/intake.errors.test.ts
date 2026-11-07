// CR-122 · p19-tool-reason: lỗi tool Ký số ⇒ mã nghiệp vụ trên kết quả registry (không còn UPSTREAM_ERROR mù).
import { describe, expect, it } from "bun:test";
import { PackToolRegistry } from "../../kit/adapters/pack-tools.registry";
import { ESignFail } from "../application/esign.helpers";
import { businessCodeOf, withBusinessCodes } from "./intake.errors";

const ctx = { tenantId: "t", userId: "u", runId: "r" } as never;
const reg = (err: unknown) => {
  const r = new PackToolRegistry();
  r.register({
    name: "contracts-x",
    pack: "contracts",
    description: "x",
    side_effect: true,
    params: [],
    run: withBusinessCodes(async () => {
      throw err;
    }),
  } as never);
  return r;
};
const codeOf = async (err: unknown) => {
  const res = await reg(err).call("contracts-x", ctx, {});
  return res.kind === "failed" ? res.code : "ok";
};

describe("intake.errors", () => {
  it("businessCodeOf", () => {
    expect(businessCodeOf(new ESignFail("ESIGN_DISABLED", "disabled"))).toBe("ESIGN_DISABLED");
    expect(businessCodeOf(new ESignFail("ESIGN_PROVIDER", "x"))).toBeNull();
    expect(businessCodeOf(new Error("NO_PARTNER_EMAIL"))).toBe("NO_PARTNER_EMAIL");
    expect(businessCodeOf(new Error("ESIGN_NODE_CONFIG_INVALID:a,b"))).toBe(
      "ESIGN_NODE_CONFIG_INVALID",
    );
    expect(businessCodeOf(new Error("connect ECONNREFUSED"))).toBeNull();
  });
  it("qua registry: mã nghiệp vụ giữ nguyên, lỗi mạng ⇒ UPSTREAM_ERROR", async () => {
    expect(await codeOf(new ESignFail("ESIGN_UNSUPPORTED_FILE", "not-pdf"))).toBe(
      "ESIGN_UNSUPPORTED_FILE",
    );
    expect(await codeOf(new Error("ESIGN_NODE_NO_SIGNER"))).toBe("ESIGN_NODE_NO_SIGNER");
    expect(await codeOf(new Error("connect ECONNREFUSED"))).toBe("UPSTREAM_ERROR");
  });
});
