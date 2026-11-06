// CR-122 · E5b · validator node Ký số + sổ validator của kit (đường lưu def): chỉ xét stage tool gửi ký, args HẰNG; lỗi theo path.
import { describe, expect, it } from "bun:test";
import { nodeConfigRegistry } from "../../kit/public";
import { ESIGN_NODE_KEY, esignNodeValidator } from "./esign-node.validator";

const U = "11111111-1111-4111-8111-111111111111";
const c = (value: string | number | boolean) => ({ from: "const", value });
const tool = (args: Record<string, unknown>) => ({
  kind: "tool",
  tool_key: "contracts-esign-send",
  args: { contract_id: c("x"), ...args },
});

const seen: unknown[] = [];
const validator = esignNodeValidator(async (_t, cfg) => {
  seen.push(cfg);
  return cfg.provider === "nope" ? [{ field: "provider", code: "PROVIDER_UNAVAILABLE" }] : [];
});

describe("E5b · esignNodeValidator", () => {
  it("cấu hình hợp lệ ⇒ không lỗi; kiểm theo công ty nhận đúng cấu hình đã giải mã", async () => {
    const r = await validator("t1", {
      index: 2,
      node: ESIGN_NODE_KEY,
      executor: tool({ provider: c("misa"), company_signers: c(`user:${U}`), due_days: c(3) }),
    });
    expect(r).toEqual([]);
    expect(seen.at(-1)).toEqual({
      provider: "misa",
      company_signers: [{ kind: "user", id: U }],
      due_days: 3,
    });
  });

  it("sai dạng ⇒ path theo khoá, sai theo công ty ⇒ path + mã của gói", async () => {
    expect(
      await validator("t1", {
        index: 0,
        node: ESIGN_NODE_KEY,
        executor: tool({ order: c("random") }),
      }),
    ).toEqual([{ path: "stages.0.executor.args.order", code: "INVALID" }]);
    expect(
      await validator("t1", {
        index: 3,
        node: ESIGN_NODE_KEY,
        executor: tool({ provider: c("nope") }),
      }),
    ).toEqual([{ path: "stages.3.executor.args.provider", code: "PROVIDER_UNAVAILABLE" }]);
  });

  it("stage không phải tool gửi ký / nguồn không hằng ⇒ bỏ qua", async () => {
    expect(
      await validator("t1", { index: 0, node: ESIGN_NODE_KEY, executor: { kind: "set" } }),
    ).toEqual([]);
    expect(
      await validator("t1", {
        index: 0,
        node: ESIGN_NODE_KEY,
        executor: tool({ provider: { from: "input", key: "p" } }),
      }),
    ).toEqual([]);
  });
});

describe("E5b · nodeConfigRegistry.check", () => {
  it("gọi validator của đúng node cho mọi stage mang `node`, gộp lỗi; node lạ / không node ⇒ bỏ qua", async () => {
    nodeConfigRegistry.register("e5b.test", validator);
    try {
      const out = await nodeConfigRegistry.check("t1", [
        { executor: { kind: "set" } },
        { node: "e5b.test", executor: tool({ provider: c("nope") }) },
        { node: "khac.node", executor: tool({ provider: c("nope") }) },
        { node: "e5b.test", executor: tool({ order: c("random") }) },
      ]);
      expect(out).toEqual([
        { path: "stages.1.executor.args.provider", code: "PROVIDER_UNAVAILABLE" },
        { path: "stages.3.executor.args.order", code: "INVALID" },
      ]);
    } finally {
      nodeConfigRegistry.clear("e5b.test");
    }
  });
});
