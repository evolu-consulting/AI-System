// CR-125 · m1 · MOD-FR-01/04/05/06/10 · sổ `MODULES` + `moduleIssues` + khớp bước cơ bản.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { APP_MANIFESTS, appNodeIssues, CORE_NODES } from "../app-manifest";
import { clusterOf } from "../hub-admin/process-module-nodes";
import {
  type BoundSummary,
  baseNodeOf,
  type FeatureModule,
  type FeatureNodeDecl,
  featureNodeByKey,
  MODULES,
  moduleIssues,
  nodesOfApp,
  withEvents,
} from "./index";

const sep = "\0";
const bound = (o: Partial<BoundSummary> = {}): BoundSummary => ({
  nodes: new Map(),
  tools: new Set(),
  facts: new Set(),
  outcomes: new Set(),
  ...o,
});
const appNode = (o: Partial<FeatureNodeDecl> = {}): FeatureNodeDecl => ({
  key: "demo.send",
  label: { vi: "Gửi", en: "Send" },
  group: "sign",
  kind: "app",
  stages: [{ executor: { kind: "tool", tool_key: "demo-send", args: {} } }],
  inputs: [],
  outputs: [],
  ...o,
});
const mod = (nodes: FeatureNodeDecl[], events: FeatureModule["events"] = []): FeatureModule => ({
  app: "demo",
  nodes,
  events,
});
const codes = (m: FeatureModule[], b: BoundSummary) => moduleIssues(m, b).map((i) => i.code);

describe("MODULES · một nguồn (MOD-FR-06)", () => {
  test("mỗi khoá node đúng một lần; manifest + CORE_NODES đọc lại từ sổ, không đổi hình", () => {
    const keys = MODULES.flatMap((m) => m.nodes.map((n) => n.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(CORE_NODES.map((n) => n.key)).toEqual([
      "core.email",
      "core.bell",
      "core.wait-until",
      "core.wait-for",
    ]);
    expect(APP_MANIFESTS.contracts?.nodes.map((n) => n.key)).toEqual([
      "contracts.esign",
      "contracts.partner-send",
    ]);
    expect(APP_MANIFESTS.community?.nodes.map((n) => n.key)).toEqual(["community.show-post"]);
    // hình AppNodeDecl cũ: không lộ kind / baseExecutor / configPort
    for (const n of [...CORE_NODES, ...nodesOfApp(MODULES, "contracts")])
      expect(Object.keys(n)).not.toContain("kind");
    expect(appNodeIssues(Object.values(APP_MANIFESTS))).toEqual([]);
  });
  test("cụm Ký số (2 stage) đọc từ sổ", () => {
    const stages = [
      { node: "contracts.esign", executor: { kind: "tool" } },
      { node: "contracts.esign", executor: { kind: "wait_event" } },
    ];
    expect(clusterOf(stages, 1)).toEqual({ node: "contracts.esign", start: 0, end: 2 });
  });
  test("sổ hiện tại không có lỗi khi đủ binding giả lập (node app có binding, base không cần)", () => {
    const b = bound({
      nodes: new Map([
        [
          "contracts.esign",
          {
            tools: ["contracts-esign-send"],
            outputs: ["event", "signed_at", "signer", "envelope_id"],
          },
        ],
        [
          "contracts.partner-send",
          { tools: ["contracts-partner-send"], outputs: ["event", "partner_reason", "round"] },
        ],
        ["core.email", { tools: [], outputs: ["sent_to"] }], // CR-125 m9 · Thông báo ghi người nhận
        ["core.bell", { tools: [], outputs: ["sent_to"] }],
        ["community.show-post", { tools: [] }],
      ]),
      tools: new Set(["contracts-esign-send", "contracts-partner-send"]),
    });
    expect(moduleIssues(MODULES, b)).toEqual([]);
  });
});

describe("MOD-FR-05 · module core", () => {
  test("có Duyệt, Nếu, Thông báo (chuông/email), Kết thúc, Chờ tới, Chờ khoảng — kind base + baseExecutor", () => {
    const core = MODULES.find((m) => m.app === "core")?.nodes ?? [];
    expect(core.every((n) => n.kind === "base" && n.baseExecutor !== undefined)).toBe(true);
    expect(core.map((n) => [n.key, n.baseExecutor])).toEqual([
      ["core.email", "notify"],
      ["core.bell", "notify"],
      ["core.wait-until", "wait_until"],
      ["core.wait-for", "wait_for"],
      ["core.approve", "approve"],
      ["core.if", "if"],
      ["core.end", "set"],
    ]);
  });
  test("def cũ không có stage.node khớp theo executor.kind", () => {
    const key = (s: Parameters<typeof baseNodeOf>[1]) => baseNodeOf(MODULES, s)?.key;
    expect(key({ executor: { kind: "approve" } })).toBe("core.approve");
    expect(key({ executor: { kind: "if" } })).toBe("core.if");
    expect(key({ executor: { kind: "wait_until" } })).toBe("core.wait-until");
    expect(key({ executor: { kind: "wait_for" } })).toBe("core.wait-for");
    expect(key({ executor: { kind: "notify", channels: ["bell", "email"] } })).toBe("core.email");
    expect(key({ executor: { kind: "notify", channels: ["bell"] } })).toBe("core.bell");
    expect(key({ executor: { kind: "set" }, outcome: "approved" })).toBe("core.end");
    // Ghi giá trị (set không outcome) và executor lạ: không khớp, không lỗi
    expect(key({ executor: { kind: "set" } })).toBeUndefined();
    expect(key({ executor: { kind: "tool" } })).toBeUndefined();
  });
  test("cổng Hẹn giờ là zod; featureNodeByKey tra được", () => {
    const n = featureNodeByKey(MODULES, "core.wait-until");
    expect(n?.configPort?.schema.safeParse({ offset_days: 3, time: "09:00" }).success).toBe(true);
    expect(n?.configPort?.schema.safeParse({ offset_days: 9999, time: "09:00" }).success).toBe(
      false,
    );
  });
});

describe("moduleIssues (MOD-FR-01/04/10)", () => {
  test("MOD_UNBOUND: node app không legacy chưa binding; legacy và base thì không đòi", () => {
    expect(codes([mod([appNode()])], bound())).toEqual(["MOD_UNBOUND"]);
    expect(moduleIssues([mod([appNode()])], bound())[0]?.message).toContain(
      "«Gửi» (demo.send) chưa có xử lý máy chủ",
    );
    expect(codes([mod([appNode({ legacy: true })])], bound())).toEqual([]);
    expect(codes([mod([appNode({ kind: "base" })])], bound())).toEqual([]);
  });
  test("MOD_DUP: khoá node trùng (giữa hai module) và sự kiện trùng; legacy chỉ kiểm trùng", () => {
    const a: FeatureModule = { app: "a", nodes: [appNode({ legacy: true })], events: [] };
    const b: FeatureModule = { app: "b", nodes: [appNode({ legacy: true })], events: [] };
    expect(moduleIssues([a, b], bound()).map((i) => i.code)).toEqual(["MOD_DUP"]);
    expect(moduleIssues([a, b], bound())[0]?.message).toBe(
      "Khoá node «demo.send» khai báo hai lần (a, b) — giữ một.",
    );
  });
  test("MOD_TOOL_MISSING và MOD_PORT_MISMATCH (so tham chiếu, khác tham chiếu ⇒ so hình)", () => {
    const port = z.strictObject({ signers: z.array(z.string()), days: z.number() });
    const n = appNode({ configPort: { schema: port } });
    const ok = (args: z.ZodTypeAny, tools: string[]) =>
      codes(
        [mod([n])],
        bound({
          nodes: new Map([["demo.send", { tools, argsSchema: args }]]),
          tools: new Set(tools),
        }),
      );
    expect(ok(port, ["demo-send"])).toEqual([]);
    expect(
      ok(z.strictObject({ signers: z.array(z.string()), days: z.number() }), ["demo-send"]),
    ).toEqual([]);
    expect(ok(port, [])).toEqual(["MOD_TOOL_MISSING"]);
    const bad = moduleIssues(
      [mod([n])],
      bound({
        nodes: new Map([
          ["demo.send", { tools: ["demo-send"], argsSchema: z.strictObject({ days: z.number() }) }],
        ]),
        tools: new Set(["demo-send"]),
      }),
    );
    expect(bad.map((i) => i.code)).toEqual(["MOD_PORT_MISMATCH"]);
    expect(bad[0]?.message).toContain("thiếu «signers»");
  });
  test("MOD_EVENT_UNBOUND, MOD_OUTCOME_UNBOUND, MOD_ORPHAN_BINDING", () => {
    const ev = {
      key: "demo.created",
      label: "Khi tạo",
      facts: [{ key: "total", label: "Tổng", type: "number" as const }],
      outcomes: [{ key: "done", label: "Xong", effect: "—" }],
      decides: false,
      required: false,
    };
    const m = mod([appNode({ legacy: true })], [ev]);
    expect(codes([m], bound())).toEqual(["MOD_EVENT_UNBOUND", "MOD_OUTCOME_UNBOUND"]);
    const k = `demo${sep}demo.created`;
    expect(codes([m], bound({ facts: new Set([k]), outcomes: new Set([k]) }))).toEqual([]);
    expect(
      codes(
        [m],
        bound({
          facts: new Set([k]),
          outcomes: new Set([k]),
          nodes: new Map([["demo.xyz", { tools: [] }]]),
        }),
      ),
    ).toEqual(["MOD_ORPHAN_BINDING"]);
  });
  test("MOD_ORPHAN_BINDING: khoá node không có dấu chấm ⇒ app «unknown»", () => {
    const m: FeatureModule = { app: "demo", events: [], nodes: [] };
    const out = moduleIssues([m], bound({ nodes: new Map([["nodot", { tools: [] }]]) }));
    expect(out.map((i) => [i.code, i.app, i.key])).toEqual([
      ["MOD_ORPHAN_BINDING", "unknown", "nodot"],
    ]);
  });
  test("tín hiệu chờ: không cần binding/dữ kiện, phải có node chờ (wait_event.event/also_events/exits.on) — không thì MOD_SIGNAL_ORPHAN", () => {
    const waiter = appNode({
      key: "demo.wait",
      stages: [
        {
          executor: {
            kind: "wait_event",
            event: "demo.done",
            also_events: ["demo.no"],
            timeout_h: 1,
          },
        },
      ],
      exits: [{ key: "x", label: { vi: "x", en: "x" }, on: ["demo.exit"] }],
    });
    const sig = (key: string) => ({ key, label: `T ${key}` });
    const m: FeatureModule = {
      app: "demo",
      events: [],
      nodes: [waiter],
      signals: [sig("demo.done"), sig("demo.no"), sig("demo.exit"), sig("demo.lonely")],
    };
    const out = moduleIssues([m], bound({ nodes: new Map([["demo.wait", { tools: [] }]]) }));
    expect(out.map((i) => [i.code, i.key])).toEqual([["MOD_SIGNAL_ORPHAN", "demo.lonely"]]);
    expect(out[0]?.message).toContain("Tín hiệu «T demo.lonely»");
  });
  test("withEvents ghép cả signals; sổ thật: Ký số dùng đủ 3 tín hiệu ký số ⇒ 0 lỗi tín hiệu", () => {
    const mods = withEvents(MODULES, Object.values(APP_MANIFESTS));
    expect(mods.find((x) => x.app === "contracts")?.signals?.map((s) => s.key)).toEqual([
      "esign.completed",
      "esign.declined",
      "esign.voided",
      "partner.confirmed",
      "partner.returned",
      "partner.declined",
    ]);
    expect(
      moduleIssues(mods, bound())
        .filter((i) => i.code === "MOD_SIGNAL_ORPHAN" || i.key.startsWith("esign."))
        .map((i) => i.code),
    ).toEqual([]);
  });
  test("withEvents ghép sự kiện của manifest vào module cùng app", () => {
    const mods = withEvents(MODULES, Object.values(APP_MANIFESTS));
    expect(mods.find((x) => x.app === "contracts")?.events.length).toBeGreaterThan(0);
    expect(mods.find((x) => x.app === "core")?.events).toEqual([]);
  });
});
