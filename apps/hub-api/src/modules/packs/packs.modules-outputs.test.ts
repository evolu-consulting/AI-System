// CR-125 · m8 · khai báo cổng ra của MỌI node trong `MODULES` × binding THẬT (core + Ký số + Gửi đối tác + Hiện bài): không `MOD_OUTPUT_UNBOUND`.
// (Boot đầy đủ có DB: packs.module-registry.int.test.ts.) Gỡ khoá khỏi binding / thêm đầu ra không pending ở contracts ⇒ test này đỏ.
import { describe, expect, it } from "bun:test";
import { MODULES } from "@ai/contracts/modules";
import { esignBindingBase } from "./contracts/nodes/esign/binding";
import { partnerSendBinding } from "./contracts/nodes/partner-send/binding";
import { bindCoreNodes, CORE_WRITTEN_OUTPUTS } from "./core/nodes/core-nodes.binding";
import { createModuleRegistry } from "./kit/adapters/module-registry";

const noop = () => undefined;
function realRegistry() {
  const r = createModuleRegistry({
    flow: { registerFactsReader: noop, registerOutcomeHandler: noop },
    nodes: { register: noop, registerTool: noop },
  });
  bindCoreNodes(r);
  r.bindNode(esignBindingBase);
  r.bindNode(partnerSendBinding());
  r.bindNode({ key: "community.show-post" });
  return r;
}

describe("đầu ra khai báo × binding thật", () => {
  it("không có MOD_OUTPUT_UNBOUND nào với sổ thật", () => {
    const issues = realRegistry()
      .issues(MODULES, { apps: ["core", "contracts", "community"] })
      .filter((i) => i.code === "MOD_OUTPUT_UNBOUND");
    expect(issues).toEqual([]);
  });
  it("Duyệt ghi decision/decided_by/feedback · Ký số, Gửi đối tác, Thông báo ghi đủ cổng (CR-125 m9)", () => {
    const r = realRegistry();
    expect(r.bindingOf("core.approve")?.outputs).toEqual(["decision", "decided_by", "feedback"]);
    expect(r.bindingOf("contracts.esign")?.outputs).toEqual([
      "event",
      "signed_at",
      "signer",
      "envelope_id",
    ]);
    expect(r.bindingOf("contracts.partner-send")?.outputs).toEqual([
      "event",
      "partner_reason",
      "round",
    ]);
    expect(r.bindingOf("core.bell")?.outputs).toEqual(["sent_to"]);
    expect(Object.keys(CORE_WRITTEN_OUTPUTS)).toEqual([
      "core.approve",
      "core.notify",
      "core.email",
      "core.bell",
      "core.subprocess",
    ]);
  });
  it("gỡ khoá ghi của Duyệt ⇒ MOD_OUTPUT_UNBOUND nói rõ node, cổng và file", () => {
    const r = createModuleRegistry({
      flow: { registerFactsReader: noop, registerOutcomeHandler: noop },
      nodes: { register: noop, registerTool: noop },
    });
    r.bindNode({ key: "core.approve", executor: "approve", outputs: ["decision"] });
    const m = r
      .issues(MODULES, { apps: ["core"] })
      .filter((i) => i.code === "MOD_OUTPUT_UNBOUND")
      .map((i) => i.message);
    expect(m).toHaveLength(2);
    expect(m[0]).toContain("Node «Duyệt» khai đầu ra «Người duyệt» (decided_by)");
    expect(m[0]).toContain("packs/core/nodes/approve/binding.ts");
  });
});
