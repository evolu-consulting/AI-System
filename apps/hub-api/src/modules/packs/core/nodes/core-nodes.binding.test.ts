// CR-125 · m5 · MOD-FR-05 · bước cơ bản core đăng ký qua sổ module, khớp executor engine; không sinh lỗi sổ.
import { describe, expect, it } from "bun:test";
import { MODULES } from "@ai/contracts/modules";
import { createModuleRegistry } from "../../kit/public";
import { bindCoreNodes } from "./core-nodes.binding";

const fresh = () =>
  createModuleRegistry({
    flow: { registerFactsReader: () => undefined, registerOutcomeHandler: () => undefined },
    nodes: { register: () => undefined, registerTool: () => undefined },
  });

describe("bindCoreNodes", () => {
  it("ghi nhận 8 bước cơ bản với executor lõi, không đăng ký validator/tool", () => {
    const r = fresh();
    const keys = bindCoreNodes(r);
    expect(keys.sort()).toEqual(
      [
        "core.approve",
        "core.bell",
        "core.email",
        "core.end",
        "core.if",
        "core.subprocess",
        "core.wait-for",
        "core.wait-until",
      ].sort(),
    );
    expect(r.bindingOf("core.approve")?.executor).toBe("approve");
    expect(r.bindingOf("core.end")?.executor).toBe("set");
    expect(r.bindingOf("core.bell")?.executor).toBe("notify");
    expect(r.bindingOf("core.wait-until")?.executor).toBe("wait_until");
  });

  it("module core: không lỗi sổ (không thiếu, không thừa binding)", () => {
    const r = fresh();
    bindCoreNodes(r);
    expect(r.issues(MODULES, { apps: ["core"] })).toEqual([]);
  });
});
