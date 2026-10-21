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
  return out;
}
