import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/http";
import { nodeConfigErrors } from "./errors";
import { checkPathOf, constArgs, ESIGN_CODEC, withConfigArgs } from "./node-config";

const U = "11111111-1111-4111-8111-111111111111";

describe("FLOW_NODE_CONFIG_INVALID → lỗi theo ô", () => {
  test("lỗi lưu theo ô", () => {
    const err = new ApiError(422, "FLOW_NODE_CONFIG_INVALID" as never, "x", {
      issues: [
        { path: "stages.3.executor.args.due_days", code: "PROVIDER_UNAVAILABLE" },
        { path: "stages.3.executor.args.company_signers" },
      ],
    });
    expect(nodeConfigErrors(err)).toEqual({
      "stages.3.executor.args.due_days": "process.admin.flow.esign.err.PROVIDER_UNAVAILABLE",
      "stages.3.executor.args.company_signers": "process.admin.apiError.FLOW_NODE_CONFIG_INVALID",
    });
    expect(nodeConfigErrors(new Error("x"))).toEqual({});
  });
});

describe("node-config", () => {
  test("đường kiểm suy ra từ options_path", () => {
    expect(checkPathOf("/pack/contracts/esign/options")).toBe(
      "/pack/contracts/esign/node-config/check",
    );
  });
  test("cấu hình Ký số ⇄ args hằng, giữ nguyên arg khác (contract_id)", () => {
    const tool = {
      key: "contracts-esign-send",
      args: { contract_id: { from: "field" as const, value: "x:y", kind: "string" as const } },
    };
    const cfg = {
      company_signers: [{ kind: "user" as const, id: U }],
      due_days: 5,
    };
    const t2 = withConfigArgs(tool, ESIGN_CODEC.keys, ESIGN_CODEC.encode(cfg));
    expect(t2.args.contract_id?.from).toBe("field");
    expect(t2.args.due_days).toEqual({ from: "const", value: "5", kind: "number" });
    expect(ESIGN_CODEC.decode(constArgs(t2, ESIGN_CODEC.keys))).toEqual(cfg);
    expect(ESIGN_CODEC.waitH(cfg)).toBe(120);
  });
  test("xoá cấu hình ⇒ chỉ còn arg khác", () => {
    const tool = {
      key: "k",
      args: { due_days: { from: "const" as const, value: "5", kind: "number" as const } },
    };
    expect(withConfigArgs(tool, ESIGN_CODEC.keys, {}).args).toEqual({});
  });
});
