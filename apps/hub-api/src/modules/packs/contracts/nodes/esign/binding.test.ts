// CR-125 · m4 · MOD-FR-04 · binding Ký số: đủ tool + schema đúng ⇒ sạch; tool khai schema khác configPort ⇒ MOD_PORT_MISMATCH.
import { describe, expect, it } from "bun:test";
import { MODULES } from "@ai/contracts/modules";
import { z } from "zod";
import { createModuleRegistry } from "../../../kit/adapters/module-registry";
import { esignBindingBase } from "./binding";

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
});
