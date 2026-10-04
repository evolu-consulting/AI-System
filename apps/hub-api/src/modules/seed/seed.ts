// HUB-FR-89 · Seed cấu hình Hub từ yaml (plan §3.6). Stub B0.
export type RunHubSeedOptions = { url: string; dir: string; appEnv: string };

export async function runHubSeed(_o: RunHubSeedOptions): Promise<{ version: number }> {
  throw new Error("not implemented");
}
