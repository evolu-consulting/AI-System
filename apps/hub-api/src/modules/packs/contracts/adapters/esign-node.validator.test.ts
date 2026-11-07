// CR-122 · E5b · validator node Ký số + sổ validator của kit (đường lưu def): chỉ xét stage tool gửi ký, args HẰNG; lỗi theo path.
import { describe, expect, it } from "bun:test";
import { nodeConfigRegistry } from "../../kit/public";
import { ESIGN_NODE_KEY, esignNodeValidator } from "./esign-node.validator";

const U = "11111111-1111-4111-8111-111111111111";
const c = (value: string | number | boolean) => ({ from: "const", value });
const tool = (args: Record<string, unknown>) => ({
  kind: "tool",
  tool_key: "contracts-esign-send",
  args: { contract_id: c("x"), company_signers: c(`user:${U}`), ...args },
});

const seen: unknown[] = [];
const validator = esignNodeValidator(async (_t, cfg) => {
  seen.push(cfg);
  return cfg.due_days === 7 ? [{ field: "due_days", code: "TOO_LONG" }] : [];
});

describe("E5b · esignNodeValidator", () => {
  it("cấu hình hợp lệ ⇒ không lỗi; kiểm theo công ty nhận đúng cấu hình đã giải mã", async () => {
    const r = await validator("t1", {
      index: 2,
      node: ESIGN_NODE_KEY,
      executor: tool({ company_signers: c(`user:${U}`), due_days: c(3) }),
    });
    expect(r).toEqual([]);
    expect(seen.at(-1)).toEqual({
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
        executor: tool({ due_days: c(7) }),
      }),
    ).toEqual([{ path: "stages.3.executor.args.due_days", code: "TOO_LONG" }]);
  });

  it("stage không phải tool gửi ký / nguồn không hằng ⇒ bỏ qua", async () => {
    expect(
      await validator("t1", { index: 0, node: ESIGN_NODE_KEY, executor: { kind: "set" } }),
    ).toEqual([]);
    expect(
      await validator("t1", {
        index: 0,
        node: ESIGN_NODE_KEY,
        executor: tool({ due_days: { from: "input", key: "p" } }),
      }),
    ).toEqual([]);
  });
});

describe("CEO-review #2 · chưa chọn người ký", () => {
  it("Ký số không có người ký công ty ⇒ chặn lưu, path + mã NO_SIGNER_SELECTED (kiểm công ty không chạy)", async () => {
    const before = seen.length;
    const noSigner = {
      kind: "tool",
      tool_key: "contracts-esign-send",
      args: { contract_id: c("x") },
    };
    expect(await validator("t1", { index: 4, node: ESIGN_NODE_KEY, executor: noSigner })).toEqual([
      { path: "stages.4.executor.args.company_signers", code: "NO_SIGNER_SELECTED" },
    ]);
    expect(seen.length).toBe(before);
  });
});

describe("E5d · validator theo khoá tool", () => {
  it("stage gọi thẳng tool không mang `node` vẫn bị kiểm, và không kiểm hai lần khi có cả node lẫn tool", async () => {
    nodeConfigRegistry.registerTool("contracts-esign-send", validator);
    nodeConfigRegistry.register("contracts.esign", validator);
    try {
      expect(
        await nodeConfigRegistry.check("t1", [{ executor: tool({ due_days: c(7) }) }]),
      ).toEqual([{ path: "stages.0.executor.args.due_days", code: "TOO_LONG" }]);
      // cùng hàm đăng ký theo node VÀ theo tool ⇒ chạy một lần (một lỗi)
      const both = await nodeConfigRegistry.check("t1", [
        { node: "contracts.esign", executor: tool({ due_days: c(7) }) },
      ]);
      expect(both).toHaveLength(1);
    } finally {
      nodeConfigRegistry.clear("contracts-esign-send");
      nodeConfigRegistry.clear("contracts.esign");
    }
  });
});

describe("E5b · nodeConfigRegistry.check", () => {
  it("gọi validator của đúng node cho mọi stage mang `node`, gộp lỗi; node lạ / không node ⇒ bỏ qua", async () => {
    nodeConfigRegistry.register("e5b.test", validator);
    try {
      const out = await nodeConfigRegistry.check("t1", [
        { executor: { kind: "set" } },
        { node: "e5b.test", executor: tool({ due_days: c(7) }) },
        { node: "khac.node", executor: tool({ due_days: c(7) }) },
        { node: "e5b.test", executor: tool({ order: c("random") }) },
      ]);
      expect(out).toEqual([
        { path: "stages.1.executor.args.due_days", code: "TOO_LONG" },
        { path: "stages.3.executor.args.order", code: "INVALID" },
      ]);
    } finally {
      nodeConfigRegistry.clear("e5b.test");
    }
  });
});
