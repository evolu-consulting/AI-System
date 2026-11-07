// CR-125 · m2 · MOD-FR-02/04 · sổ module máy chủ: binding đủ ⇒ không lỗi; thiếu ⇒ ném đúng câu tiếng Việt; đăng ký hộ sổ cũ; lọc theo app đang gắn.
import { describe, expect, it } from "bun:test";
import type { FeatureModule } from "@ai/contracts/modules";
import { z } from "zod";
import type { FactsReader, OutcomeHandler } from "../application/flow-events.ports";
import { createModuleRegistry } from "./module-registry";

const calls: string[] = [];
const sinks = () => {
  calls.length = 0;
  return {
    flow: {
      registerFactsReader: (r: FactsReader) => void calls.push(`facts:${r.packKey}`),
      registerOutcomeHandler: <TX>(h: OutcomeHandler<TX>) =>
        void calls.push(`outcome:${h.packKey}`),
    },
    nodes: {
      register: (k: string) => void calls.push(`node:${k}`),
      registerTool: (k: string) => void calls.push(`tool:${k}`),
    },
  };
};

const event = {
  key: "demo.created",
  label: "Khi tạo",
  facts: [{ key: "total", label: "Tổng", type: "number" as const }],
  outcomes: [{ key: "done", label: "Xong", effect: "—" }],
  decides: false,
  required: false,
};
const PORT = z.strictObject({ days: z.number() });
const MODS: FeatureModule[] = [
  {
    app: "demo",
    events: [event],
    nodes: [
      {
        key: "demo.send",
        label: { vi: "Gửi", en: "Send" },
        group: "sign",
        kind: "app",
        feature: "demo-write",
        stages: [{ executor: { kind: "tool", tool_key: "demo-send", args: {} } }],
        inputs: [],
        outputs: [],
        configPort: { schema: PORT },
      },
    ],
  },
];

const reader = (): FactsReader => ({
  packKey: "demo",
  events: ["demo.created"],
  read: async () => null,
});
const handler = (): OutcomeHandler<never> => ({
  packKey: "demo",
  events: ["demo.created"],
  apply: async () => "applied",
});

function full() {
  const r = createModuleRegistry(sinks());
  r.bindTool({ pack: "demo", name: "demo-send" });
  r.bindNode({ key: "demo.send", tools: ["demo-send"], argsSchema: PORT });
  r.bindEvent({ facts: reader(), outcome: handler() });
  return r;
}

describe("moduleRegistry.verify (MOD-FR-02)", () => {
  it("đủ binding ⇒ không lỗi, không ném", () => {
    const r = full();
    expect(r.issues(MODS)).toEqual([]);
    expect(() => r.verify(MODS)).not.toThrow();
  });

  it("thiếu binding Ký số ⇒ ném «Khởi động dừng: N lỗi module» + câu MOD_UNBOUND, log error", () => {
    const r = createModuleRegistry(sinks());
    r.bindEvent({ facts: reader(), outcome: handler() });
    const logs: string[] = [];
    let msg = "";
    try {
      r.verify(MODS, { log: (m) => logs.push(m) });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toStartWith("Khởi động dừng: 1 lỗi module");
    expect(msg).toContain("[MOD_UNBOUND] Node «Gửi» (demo.send) chưa có xử lý máy chủ");
    expect(logs).toEqual([msg]);
  });

  it("tool chưa đăng ký ⇒ MOD_TOOL_MISSING; schema args khác cổng ⇒ MOD_PORT_MISMATCH (MOD-FR-04)", () => {
    const r = createModuleRegistry(sinks());
    r.bindNode({
      key: "demo.send",
      tools: ["demo-send"],
      argsSchema: z.strictObject({ x: z.string() }),
    });
    r.bindEvent({ facts: reader(), outcome: handler() });
    expect(r.issues(MODS).map((i) => i.code)).toEqual(["MOD_TOOL_MISSING", "MOD_PORT_MISMATCH"]);
  });

  it("sự kiện thiếu bộ đọc / xử lý kết quả; binding thừa ⇒ MOD_ORPHAN_BINDING", () => {
    const r = createModuleRegistry(sinks());
    r.bindTool({ pack: "demo", name: "demo-send" });
    r.bindNode({ key: "demo.send", tools: ["demo-send"] });
    r.bindNode({ key: "demo.extra" });
    expect(r.issues(MODS).map((i) => i.code)).toEqual([
      "MOD_EVENT_UNBOUND",
      "MOD_OUTCOME_UNBOUND",
      "MOD_ORPHAN_BINDING",
    ]);
  });

  it("apps lọc cả khai báo lẫn binding: app không gắn ⇒ bỏ qua", () => {
    const r = createModuleRegistry(sinks());
    expect(r.issues(MODS, { apps: ["core"] })).toEqual([]);
    r.bindNode({ key: "demo.extra" });
    expect(r.issues(MODS, { apps: ["core"] })).toEqual([]);
    expect(r.issues(MODS, { apps: ["demo"] }).length).toBeGreaterThan(0);
  });
});

describe("MOD_OUTPUT_UNBOUND (CR-125 m8)", () => {
  const withOut: FeatureModule[] = [
    {
      app: "demo",
      events: [],
      nodes: [
        {
          ...(MODS[0]?.nodes[0] as FeatureModule["nodes"][number]),
          outputs: [
            {
              key: "result",
              type: "string",
              required: true,
              label: { vi: "Kết quả", en: "Result" },
            },
          ],
        },
      ],
    },
  ];
  it("binding không ghi đầu ra đã khai ⇒ ném «Khởi động dừng» + câu tiếng Việt MOD_OUTPUT_UNBOUND", () => {
    const r = createModuleRegistry(sinks());
    r.bindTool({ pack: "demo", name: "demo-send" });
    r.bindNode({ key: "demo.send", tools: ["demo-send"], argsSchema: PORT });
    expect(() => r.verify(withOut)).toThrow(
      /\[MOD_OUTPUT_UNBOUND\] Node «Gửi» khai đầu ra «Kết quả» \(result\) nhưng xử lý máy chủ chưa ghi/,
    );
  });
  it("binding khai outputs khớp ⇒ xanh", () => {
    const r = createModuleRegistry(sinks());
    r.bindTool({ pack: "demo", name: "demo-send" });
    r.bindNode({ key: "demo.send", tools: ["demo-send"], argsSchema: PORT, outputs: ["result"] });
    expect(r.issues(withOut)).toEqual([]);
  });
  it("bindNode lặp cùng khoá: outputs của lần sau thắng, không mất outputs lần trước nếu lần sau không khai", () => {
    const r = createModuleRegistry(sinks());
    r.bindTool({ pack: "demo", name: "demo-send" });
    r.bindNode({ key: "demo.send", tools: ["demo-send"], argsSchema: PORT, outputs: ["result"] });
    r.bindNode({ key: "demo.send", validate: async () => [] });
    expect(r.issues(withOut)).toEqual([]);
  });
});

describe("đăng ký hộ sổ cũ (hành vi không đổi)", () => {
  it("bindEvent/bindNode chuyển nguyên đối tượng cho flowPortRegistry/nodeConfigRegistry, gộp tool khi bindNode lặp", () => {
    const s = sinks();
    const r = createModuleRegistry(s);
    const v = async () => [];
    r.bindEvent({ facts: reader(), outcome: handler() });
    r.bindNode({ key: "demo.send", tools: ["a"], toolValidators: { "demo-send": v } });
    r.bindNode({ key: "demo.send", tools: ["b"], validate: v, optionsPath: "/pack/demo/options" });
    expect(calls).toEqual(["facts:demo", "outcome:demo", "tool:demo-send", "node:demo.send"]);
    expect(r.bindingOf("demo.send")?.tools).toEqual(["a", "b"]);
    expect(r.bindingOf("demo.send")?.optionsPath).toBe("/pack/demo/options");
  });
});
