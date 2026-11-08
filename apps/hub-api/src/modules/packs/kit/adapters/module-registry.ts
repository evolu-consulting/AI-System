// CR-125 · m2 · MOD-FR-01/02/04/10 · SỔ MODULE máy chủ: gói đăng ký xử lý của node/sự kiện theo khoá module; cuối `packs.mount` gọi `verify`
// ⇒ đối chiếu với khai báo `MODULES` bằng luật thuần `moduleIssues` (contracts). Có lỗi ⇒ ném, hub không lên. Đăng ký HỘ `flowPortRegistry`
// / `nodeConfigRegistry` (API cũ giữ nguyên, engine vẫn tra như trước). O(node + sự kiện), chỉ chạy một lần lúc khởi động.
import {
  type BoundSummary,
  type FeatureModule,
  type ModuleIssue,
  moduleIssues,
} from "@ai/contracts/modules";
import type {
  EventBinding,
  ModuleRegistry,
  ModuleVerifyOpts,
  NodeBinding,
} from "../application/module.ports";
import { flowPortRegistry } from "./flow-port-registry";
import { nodeConfigRegistry } from "./node-config-registry";

const SEP = "\0";

type Sinks = {
  flow: Pick<typeof flowPortRegistry, "registerFactsReader" | "registerOutcomeHandler">;
  nodes: Pick<typeof nodeConfigRegistry, "register" | "registerTool">;
};

/** App của khoá node `<app>.<node>`; không có dấu chấm ⇒ `unknown` (khớp luật contracts). */
const appOfKey = (key: string): string =>
  key.includes(".") ? (key.split(".")[0] ?? "") : "unknown";

type RegState = {
  nodes: ReadonlyMap<string, NodeBinding>;
  tools: ReadonlyMap<string, string>;
  facts: ReadonlySet<string>;
  outcomes: ReadonlySet<string>;
};

function summarize(s: RegState, apps: ReadonlySet<string> | null): BoundSummary {
  const { nodes, tools, facts, outcomes } = s;
  const inApps = (app: string) => apps === null || apps.has(app);
  const keep = (set: ReadonlySet<string>) =>
    new Set([...set].filter((k) => inApps(k.split(SEP)[0] ?? "")));
  return {
    nodes: new Map(
      [...nodes]
        .filter(([k]) => inApps(appOfKey(k)))
        .map(([k, b]) => [
          k,
          {
            tools: b.tools ?? [],
            ...(b.argsSchema ? { argsSchema: b.argsSchema } : {}),
            ...(b.outputs ? { outputs: b.outputs } : {}),
          },
        ]),
    ),
    tools: new Set([...tools].filter(([, app]) => inApps(app)).map(([k]) => k)),
    facts: keep(facts),
    outcomes: keep(outcomes),
  };
}

function failWith(found: readonly ModuleIssue[], opts?: ModuleVerifyOpts): void {
  if (found.length === 0) return;
  const text = [
    `Khởi động dừng: ${found.length} lỗi module`,
    ...found.map((i) => `- [${i.code}] ${i.message}`),
  ].join("\n");
  opts?.log?.(text, { issues: found.map((i) => ({ code: i.code, key: i.key })) });
  throw new Error(text);
}

export function createModuleRegistry(sinks: Sinks): ModuleRegistry {
  const nodes = new Map<string, NodeBinding>();
  const tools = new Map<string, string>(); // khoá tool → app
  const facts = new Set<string>(); // `<app>\0<event>`
  const outcomes = new Set<string>();

  const state: RegState = { nodes, tools, facts, outcomes };
  const summary = (apps: ReadonlySet<string> | null): BoundSummary => summarize(state, apps);

  const issues = (mods: readonly FeatureModule[], opts?: ModuleVerifyOpts): ModuleIssue[] => {
    const apps = opts?.apps ? new Set(opts.apps) : null;
    const scoped = apps ? mods.filter((m) => apps.has(m.app)) : mods;
    return moduleIssues(scoped, summary(apps));
  };

  return {
    bindNode(b) {
      const prev = nodes.get(b.key);
      nodes.set(b.key, {
        ...prev,
        ...b,
        tools: [...new Set([...(prev?.tools ?? []), ...(b.tools ?? [])])],
      });
      if (b.validate) sinks.nodes.register(b.key, b.validate);
      for (const [tool, v] of Object.entries(b.toolValidators ?? {}))
        sinks.nodes.registerTool(tool, v);
    },
    bindTool(t) {
      tools.set(t.name, t.pack);
    },
    bindEvent<TX>(b: EventBinding<TX>) {
      if (b.facts) {
        sinks.flow.registerFactsReader(b.facts);
        for (const e of b.facts.events) facts.add(`${b.facts.packKey}${SEP}${e}`);
      }
      if (b.outcome) {
        sinks.flow.registerOutcomeHandler(b.outcome);
        for (const e of b.outcome.events) outcomes.add(`${b.outcome.packKey}${SEP}${e}`);
      }
    },
    bindingOf: (key) => nodes.get(key),
    issues,
    verify(mods, opts) {
      failWith(issues(mods, opts), opts);
    },
  };
}

/** Sổ dùng chung trong process (cùng khuôn `flowPortRegistry`/`slotRegistry`). */
export const moduleRegistry: ModuleRegistry = createModuleRegistry({
  flow: flowPortRegistry,
  nodes: nodeConfigRegistry,
});
