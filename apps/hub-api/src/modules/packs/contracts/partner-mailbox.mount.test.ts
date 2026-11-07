// CR-124 · q3 · khuôn CR-125 · sổ module: node «contracts.partner-send» + sự kiện `contract.received` + tín hiệu `partner.*` có ĐỦ binding
// (không MOD_UNBOUND / MOD_TOOL_MISSING / MOD_PORT_MISMATCH / MOD_EVENT_UNBOUND / MOD_OUTCOME_UNBOUND / MOD_SIGNAL_ORPHAN). Mount tắt mặc định bộ chuyển.
import { describe, expect, it } from "bun:test";
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
import { MODULES, withEvents } from "@ai/contracts/modules";
import type { Db } from "@ai/db";
import { createModuleRegistry, createPartnerMailboxPortRegistry } from "../kit/public";
import { partnerSendTool } from "./adapters/partner-send.tool";
import { contractsFactsReader, contractsOutcomeHandler } from "./flow-events.mount";
import { partnerSendBinding } from "./nodes/partner-send/binding";

const registry = () =>
  createModuleRegistry({
    flow: { registerFactsReader: () => undefined, registerOutcomeHandler: () => undefined },
    nodes: { register: () => undefined, registerTool: () => undefined },
  });

describe("CR-124 q3 · sổ module", () => {
  const mods = withEvents(MODULES, Object.values(APP_MANIFESTS));
  const mine = (r: ReturnType<typeof registry>) =>
    r
      .issues(mods, { apps: ["contracts"] })
      .filter((i) => /partner|contract\.received/.test(`${i.key} ${i.detail ?? ""} ${i.message}`));

  it("đủ binding (tool + node + facts/outcome) ⇒ 0 lỗi module cho node gửi đối tác", () => {
    const r = registry();
    r.bindTool(partnerSendTool({ uow: {} as never }));
    r.bindNode(partnerSendBinding());
    r.bindEvent({ facts: contractsFactsReader({} as Db), outcome: contractsOutcomeHandler() });
    expect(mine(r)).toEqual([]);
  });

  it("thiếu binding node ⇒ MOD_UNBOUND nói rõ node nào; thiếu tool ⇒ MOD_TOOL_MISSING", () => {
    const none = registry();
    none.bindEvent({ facts: contractsFactsReader({} as Db), outcome: contractsOutcomeHandler() });
    expect(mine(none).map((i) => i.code)).toEqual(["MOD_UNBOUND"]);
    const noTool = registry();
    noTool.bindNode(partnerSendBinding());
    noTool.bindEvent({ facts: contractsFactsReader({} as Db), outcome: contractsOutcomeHandler() });
    expect(mine(noTool).map((i) => i.code)).toEqual(["MOD_TOOL_MISSING"]);
  });

  it("cổng hộp thư: mặc định vắng (bộ chuyển giữ đường q1), đăng ký rồi gỡ được", () => {
    const p = createPartnerMailboxPortRegistry();
    expect(p.get()).toBeUndefined();
    const port = { receive: async () => 0, onReplies: async () => undefined };
    p.set(port);
    expect(p.get()).toBe(port);
    p.set(undefined);
    expect(p.get()).toBeUndefined();
  });
});
