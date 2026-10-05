// HUB-H2b-AC-12 · H2b F7 (spec-decisions T16): `bun run test:smoke:live` — smoke Hub + Runtime/CLI thật (`tests/smoke`).
// Vắng `HUB_LIVE` → bỏ qua, exit 0 (không chặn `done:h2b`); có cờ → `bun test tests/smoke` (bunfig.stack.toml, timeout dài).
import { resolve } from "node:path";

export const SMOKE_ARGS = [
  "--env-file=.env.local",
  "--config=bunfig.stack.toml",
  "test",
  "--timeout",
  "300000",
  "tests/smoke",
];

export function smokeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.HUB_LIVE?.trim();
  return !!v && v !== "0";
}

if (import.meta.main) {
  if (!smokeEnabled()) {
    console.log("test:smoke:live: bỏ qua (vắng HUB_LIVE=1)");
    process.exit(0);
  }
  const p = Bun.spawnSync([process.execPath, ...SMOKE_ARGS], {
    cwd: resolve(import.meta.dir, "../../.."),
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(p.exitCode ?? 1);
}
