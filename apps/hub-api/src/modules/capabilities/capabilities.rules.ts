// CR-118 · UW-FR-04 · UW-FR-16..19 · ADR-0036 (đề xuất) · luật thuần của read-model năng lực: lát cắt (tenant, user) cho
// `GET /pack/me` và toàn view tenant cho `GET /hub-admin/tenants/:id/capabilities`. Chỉ GHÉP kết quả luật gốc (quyền gói,
// entitlement, agent, khe) — luật thật vẫn chạy ở chỗ cũ (server fail-closed). DLC (của Rowan) không vào view.
import type {
  CapabilityApp,
  CapabilityLevel,
  ConfigVersions,
  ShellBrand,
  ShellMeResponse,
  TenantCapabilitiesResponse,
} from "@ai/contracts";

export type PackAction = "read" | "write" | "admin";
const LEVELS: readonly PackAction[] = ["read", "write", "admin"];
/** Gói không bao giờ vào view (DLC là của Rowan — D5). */
const HIDDEN_PACKS: ReadonlySet<string> = new Set(["dlc"]);
/** Thứ tự chọn trang chủ khi user đọc được nhiều gói. */
const HOME_ORDER = ["contracts", "community"];

type FeatureLite = { id: string; key: string; status: string };

/** Gói đã cài = có đủ feature `<k>-read|write|admin` (chuẩn N1 `packFeatureKey`); sắp theo khoá. */
export function installedPacks(features: readonly FeatureLite[]): string[] {
  const keys = new Set(features.map((f) => f.key));
  const out: string[] = [];
  for (const f of features) {
    if (!f.key.endsWith("-read")) continue;
    const k = f.key.slice(0, -"-read".length);
    if (HIDDEN_PACKS.has(k) || !keys.has(`${k}-write`) || !keys.has(`${k}-admin`)) continue;
    out.push(k);
  }
  return out.sort();
}

/** Add-on của gói = feature tiền tố `<k>-` hoặc `<k>.` trừ 3 mức; sắp theo khoá. */
export function addonKeysOf(features: readonly FeatureLite[], pack: string): string[] {
  const levels = new Set(LEVELS.map((a) => `${pack}-${a}`));
  return features
    .map((f) => f.key)
    .filter((k) => (k.startsWith(`${pack}-`) || k.startsWith(`${pack}.`)) && !levels.has(k))
    .sort();
}

export const levelOf = (actions: readonly string[]): CapabilityLevel => {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    const a = LEVELS[i] as PackAction;
    if (actions.includes(a)) return a;
  }
  return "off";
};

export type ShellInput = {
  versions: ConfigVersions;
  user: { id: string; tenantId: string; role: string; external: boolean };
  /** Kết quả luật quyền gói (`packAccessInput` + `packActionsFor`) mỗi gói đã cài. */
  packs: readonly { key: string; enabled: boolean; actions: readonly PackAction[] }[];
  /** Add-on bật cho tenant (`tenantFeatureOn`), theo gói. */
  addons: readonly { pack: string; key: string; on: boolean }[];
  brand: ShellBrand | null;
  /** Gói mở cho đối tác (`EXTERNAL_PACKS`). */
  externalPacks?: ReadonlySet<string>;
  /** `default_app` của user / công ty (admin-api, bump `config_version`); vắng ⇒ home theo quyền. */
  defaultApp?: { user: string | null; tenant: string | null };
  /** Flow runtime của kit đang bật (`HUB_FLOW_RUNTIME=on`) ⇒ route `/pack/<k>/flow/*` có mặt; web chỉ gọi khi cờ này bật. */
  flowRuntime?: boolean;
};

/** Khoá cờ phẳng trong `/pack/me.flags` báo flow runtime bật/tắt (không trùng `<gói>` hay `<gói>.<action>`). */
export const FLOW_RUNTIME_FLAG = "flow.runtime";

/** Trang chủ: default_app (user rồi công ty) nếu user đọc được gói đó; không thì theo quyền (contracts → community → đầu). */
function homeOf(i: ShellInput, readable: ReadonlySet<string>, apps: readonly string[]) {
  for (const k of [i.defaultApp?.user, i.defaultApp?.tenant]) if (k && readable.has(k)) return k;
  return HOME_ORDER.find((k) => readable.has(k)) ?? apps[0] ?? null;
}

const DEFAULT_EXTERNAL: ReadonlySet<string> = new Set(["community"]);

/** Gói theo user: đối tác chỉ gói mở cho đối tác; ghi flags `<k>` + `<k>.<action>`. */
function shellPacks(i: ShellInput, flags: Record<string, boolean>) {
  const ext = i.externalPacks ?? DEFAULT_EXTERNAL;
  const packs: ShellMeResponse["packs"] = {};
  const readable = new Set<string>();
  for (const p of i.packs) {
    const on = p.enabled && (!i.user.external || ext.has(p.key));
    const actions = on ? [...p.actions] : [];
    packs[p.key] = { enabled: on, level: levelOf(actions), actions };
    if (actions.includes("read")) readable.add(p.key);
    flags[p.key] = readable.has(p.key);
    for (const a of LEVELS) flags[`${p.key}.${a}`] = actions.includes(a);
  }
  return { packs, readable };
}

/** `GET /pack/me`: đối tác chỉ thấy gói mở cho đối tác; add-on chỉ tính khi user đọc được gói. */
export function shellMe(i: ShellInput): ShellMeResponse {
  const flags: Record<string, boolean> = {};
  const { packs, readable } = shellPacks(i, flags);
  flags[FLOW_RUNTIME_FLAG] = i.flowRuntime === true;
  const addons: string[] = [];
  for (const a of i.addons) {
    const on = a.on && readable.has(a.pack);
    flags[a.key] = on;
    if (on) addons.push(a.key);
  }
  const apps = i.packs.map((p) => p.key).filter((k) => readable.has(k));
  return {
    versions: i.versions,
    user: {
      id: i.user.id,
      tenant_id: i.user.tenantId,
      role: i.user.role,
      kind: i.user.external ? "external" : "internal",
    },
    packs,
    addons,
    flags,
    brand: i.brand,
    home: homeOf(i, readable, apps),
    apps,
  };
}

/** FNV-1a 32 bit (thuần, đủ cho ETag nội dung — không dùng cho bảo mật). */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** ETag = cặp version + băm thân (gồm user/role ⇒ không lẫn giữa người). Nguồn không bump version (brand) vẫn đổi ETag. */
export const etagOf = (v: ConfigVersions, body: string): string =>
  `"a${v.admin}.h${v.hub}.${fnv1a(body)}"`;

/** `If-None-Match` (RFC 9110 so khớp yếu): `*`, danh sách, tiền tố `W/`. */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => {
    const x = t.trim();
    return x === "*" || x === etag || x === `W/${etag}`;
  });
}

export type SlotRow = {
  /** null = mặc định khe (`process_slots`). */
  tenantId: string | null;
  slot: string;
  defId: string | null;
  defName: string | null;
  version: number | null;
};
export type AgentLite = { id: string; key: string; name: string; enabled: boolean };
type ToolLite = { key: string; side_effect: boolean; action: PackAction };

export type CapsInput = {
  tenantId: string;
  versions: ConfigVersions;
  features: readonly FeatureLite[];
  /** Feature id có entitlement còn hiệu lực cho tenant. */
  entitled: (featureId: string) => boolean;
  agents: readonly AgentLite[];
  entitledAgentIds: ReadonlySet<string>;
  /** Gói → khoá agent của gói (`packs.pack_agents`). */
  packAgents: ReadonlyMap<string, readonly string[]>;
  tools: (pack: string) => readonly ToolLite[];
  slots: readonly SlotRow[];
  standalone: readonly {
    id: string;
    name: string;
    version: number | null;
    tenantId: string | null;
  }[];
  workflows: readonly { id: string; key: string; name: string; enabled: boolean }[];
  agentWorkflows: ReadonlyMap<string, ReadonlySet<string>>;
  defaults: { defaultAgentId: string; fallbackAgentId: string | null; onNoMatch: string } | null;
  limits: { uploads: number | null; actions: number | null; aiTokens: number | null } | null;
};

const featureOn = (i: CapsInput, f: FeatureLite | undefined): boolean =>
  f !== undefined && f.status !== "off" && i.entitled(f.id);

function slotsOf(i: CapsInput, pack: string): CapabilityApp["slots"] {
  const mine = new Map<string, SlotRow>();
  const defaults = new Map<string, SlotRow>();
  for (const s of i.slots) {
    if (s.slot.split(".", 1)[0] !== pack) continue;
    if (s.tenantId === i.tenantId) mine.set(s.slot, s);
    else if (s.tenantId === null) defaults.set(s.slot, s);
  }
  const keys = [...new Set([...defaults.keys(), ...mine.keys()])].sort();
  return keys.map((k) => {
    const s = (mine.get(k) ?? defaults.get(k)) as SlotRow;
    return {
      slot: k,
      def_id: s.defId,
      def_name: s.defName,
      version: s.version,
      is_default: !mine.has(k),
    };
  });
}

const named = (i: CapsInput, a: AgentLite) => ({
  key: a.key,
  name: a.name,
  enabled: a.enabled && i.entitledAgentIds.has(a.id),
});

function appCard(i: CapsInput, pack: string, byKey: ReadonlyMap<string, FeatureLite>) {
  const actions = LEVELS.filter((a) => featureOn(i, byKey.get(`${pack}-${a}`)));
  const agentKeys = new Set(i.packAgents.get(pack) ?? []);
  return {
    key: pack,
    level: levelOf(actions),
    addons: addonKeysOf(i.features, pack).map((k) => ({ key: k, on: featureOn(i, byKey.get(k)) })),
    slots: slotsOf(i, pack),
    agents: i.agents.filter((a) => agentKeys.has(a.key)).map((a) => named(i, a)),
    tools: [...i.tools(pack)],
  };
}

function shared(i: CapsInput): TenantCapabilitiesResponse["shared"] {
  const owned = new Set([...i.packAgents.values()].flat());
  const mine = i.agents.filter((a) => i.entitledAgentIds.has(a.id));
  const keyOf = (id: string | null) =>
    id ? (i.agents.find((a) => a.id === id)?.key ?? null) : null;
  return {
    agents: mine.filter((a) => !owned.has(a.key)).map((a) => named(i, a)),
    dify_workflows: i.workflows.map((w) => ({
      key: w.key,
      name: w.name,
      enabled: w.enabled,
      used_by: mine.filter((a) => i.agentWorkflows.get(a.id)?.has(w.id)).map((a) => a.key),
    })),
    standalone_flows: i.standalone
      .filter((d) => d.tenantId === null || d.tenantId === i.tenantId)
      .map((d) => ({ id: d.id, name: d.name, version: d.version })),
    default_model: i.defaults
      ? {
          default_agent: keyOf(i.defaults.defaultAgentId),
          fallback_agent: keyOf(i.defaults.fallbackAgentId),
          on_no_match: i.defaults.onNoMatch,
        }
      : null,
  };
}

/** Toàn view năng lực của tenant: thẻ app + "Dùng chung" + "Giới hạn" (chỉ đọc). */
export function tenantCapabilities(i: CapsInput): TenantCapabilitiesResponse {
  const byKey = new Map(i.features.map((f) => [f.key, f]));
  return {
    tenant_id: i.tenantId,
    versions: i.versions,
    apps: installedPacks(i.features).map((p) => appCard(i, p, byKey)),
    shared: shared(i),
    limits: {
      uploads_day: i.limits?.uploads ?? null,
      actions_day: i.limits?.actions ?? null,
      ai_tokens_day: i.limits?.aiTokens ?? null,
    },
  };
}
