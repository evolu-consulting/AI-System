// seed-keep-studio · cot agent ma Studio da doi (hub.agents.studio_overrides) thi `hub:seed` giu gia tri hien co.
export const SEED_AGENT_FIELDS = [
  "name",
  "description",
  "runtime",
  "profile_id",
  "system_prompt",
  "runtime_options",
  "timeout_s",
  "token_budget",
  "enabled",
] as const;
export const OPT_PREFIX = "runtime_options.";
export type SeedAgentField = (typeof SEED_AGENT_FIELDS)[number];
export type SeedAgentFields = Record<SeedAgentField, unknown>;

/** Gia tri sau seed: cot nam trong `overrides` giu cua DB, cot con lai theo yaml. */
export function mergeSeedAgent(
  existing: SeedAgentFields,
  seed: SeedAgentFields,
  overrides: readonly string[],
): SeedAgentFields {
  const out = { ...seed };
  for (const f of SEED_AGENT_FIELDS) if (overrides.includes(f)) out[f] = existing[f];
  // runtime_options theo tung khoa: `runtime_options.<k>` giu khoa k cua DB (vang trong DB => bo khoa), khoa khac theo yaml.
  const keys = overrides
    .filter((o) => o.startsWith(OPT_PREFIX))
    .map((o) => o.slice(OPT_PREFIX.length));
  if (keys.length && !overrides.includes("runtime_options")) {
    const cur = (existing.runtime_options ?? {}) as Record<string, unknown>;
    const opts = { ...((seed.runtime_options ?? {}) as Record<string, unknown>) };
    for (const k of keys) {
      if (k in cur) opts[k] = cur[k];
      else delete opts[k];
    }
    out.runtime_options = opts;
  }
  return out;
}
