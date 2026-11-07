// CR-125 · m4 · MOD-FR-04 · binding Ký số: đủ tool + schema đúng ⇒ sạch; tool khai schema khác configPort ⇒ MOD_PORT_MISMATCH.
import { describe, expect, it } from "bun:test";
import { MODULES } from "@ai/contracts/modules";
import { type EsignNodeConfig, encodeEsignNodeArgs } from "@ai/contracts/pack-contracts";
import { z } from "zod";
import { createModuleRegistry } from "../../../kit/adapters/module-registry";
import { esignArgsSchema, esignBindingBase, esignBindingChecks } from "./binding";

const sinks = () =>
  ({
    flow: { registerFactsReader: () => undefined, registerOutcomeHandler: () => undefined },
    nodes: { register: () => undefined, registerTool: () => undefined },
  }) as never;
const contracts = MODULES.filter((m) => m.app === "contracts");
const issuesOf = (b: typeof esignBindingBase) => {
  const r = createModuleRegistry(sinks());
  r.bindTool({ pack: "contracts", name: "contracts-esign-send" });
  r.bindNode(b);
  return r.issues(contracts, { apps: ["contracts"] }).filter((i) => i.key === "contracts.esign");
};

describe("binding contracts.esign", () => {
  it("đủ tool + argsSchema = configPort ⇒ không lỗi", () => {
    expect(issuesOf(esignBindingBase)).toEqual([]);
  });
  it("MOD_PORT_MISMATCH khi schema args của tool khác configPort", () => {
    const bad = {
      ...esignBindingBase,
      argsSchema: z.strictObject({ signers: z.array(z.string()) }),
    };
    expect(issuesOf(bad).map((i) => i.code)).toEqual(["MOD_PORT_MISMATCH"]);
  });

  it("def đã lưu còn `provider` + chuỗi người ký ⇒ nạp, kiểm và lưu lại được (provider bị bỏ)", async () => {
    const U = "0190a3c4-1111-7000-8000-000000000001";
    const stored = {
      provider: "docusign",
      contract_id: "c1",
      company_signers: `user:${U}`,
      order: "parallel",
      due_days: "3",
    };
    const parsed = esignArgsSchema.safeParse(stored);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      company_signers: [{ kind: "user", id: U }],
      order: "parallel",
      due_days: 3,
    });
    const seen: unknown[] = [];
    const v = esignBindingChecks(async (_t, c) => {
      seen.push(c);
      return [];
    }).toolValidators?.["contracts-esign-send"];
    const c = (x: unknown) => ({ from: "const", value: x });
    const executor = {
      kind: "tool",
      tool_key: "contracts-esign-send",
      args: Object.fromEntries(Object.entries(stored).map(([k, x]) => [k, c(x)])),
    };
    expect(await v?.("t1", { index: 0, node: "contracts.esign", executor })).toEqual([]);
    expect(seen).toEqual([parsed.data]);
    const saved = encodeEsignNodeArgs(parsed.data as EsignNodeConfig);
    expect(saved).toEqual({ company_signers: `user:${U}`, order: "parallel", due_days: 3 });
    expect(esignArgsSchema.safeParse(saved).success).toBe(true);
  });
});
