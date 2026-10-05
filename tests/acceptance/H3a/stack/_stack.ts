// WRK-FR-22 · WRK-FR-15 · AC-W02 · hạ tầng test nhóm S H3a (test-plan H3a §2 "Stack", G6; test-plan-py §3 S01–S04):
// hub-api THẬT (host) + agent-runtime THẬT (container, `fake-cli`) + Postgres/Redis compose — dùng lại bộ dựng H2b
// (`bootStackH2b`, khoá, không sửa) với env probe biên dev (PL6): `AGENT_RT_PROBE_S=2`, `AGENT_RT_PROBE_LOGGED_OUT_S=1`,
// timeout 10 s (N1), `AGENT_RT_FAKE_PROBE_FILE` trong bind-mount repo (`<REPO>` ⇔ `/work`, `dockerArgs`): host
// `<REPO>/.data/h3a-stack/probe.txt` ⇔ container `/work/.data/h3a-stack/probe.txt` (`.data/` trong `.gitignore`).
// Không chứa `it(...)`. Chạy riêng: `bun run test:h3a:stack` (không song song test:int TS/Python cùng DB).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Sql } from "../../H1/_fixtures";
import { type RuntimeBox, startRuntimeH2a } from "../../H2a/stack/_stack";
import { bootStackH2b, type StackH2b } from "../../H2b/stack/_stack";

const REPO = resolve(import.meta.dir, "../../../..");
export const PROBE_DIR_HOST = resolve(REPO, ".data/h3a-stack");
export const PROBE_FILE_HOST = resolve(PROBE_DIR_HOST, "probe.txt");
export const PROBE_FILE_CT = "/work/.data/h3a-stack/probe.txt";
export const PROVIDER = "fake-cli";

/** Env Runtime H3a (biên dev PL6, N1). */
export const H3A_RT_ENV: Record<string, string> = {
  AGENT_RT_PROBE_S: "2",
  AGENT_RT_PROBE_LOGGED_OUT_S: "1",
  AGENT_RT_PROBE_TIMEOUT_S: "10",
  AGENT_RT_FAKE_PROBE_FILE: PROBE_FILE_CT,
};

/** Ghi chỉ thị probe (`rt` §5); `null` ⇒ xoá file + `.calls` (vắng file ⇒ `ok`). */
export function probeDirective(text: string | null): void {
  mkdirSync(PROBE_DIR_HOST, { recursive: true });
  if (text === null) {
    rmSync(PROBE_FILE_HOST, { force: true });
    rmSync(`${PROBE_FILE_HOST}.calls`, { force: true });
  } else writeFileSync(PROBE_FILE_HOST, `${text}\n`);
}

/** Runtime H3a thêm (mẫu H2a, `dockerArgs`): env probe + `env` riêng của ca. */
export function startRuntimeBoxH3a(
  name: string,
  worker: string,
  hubUrl: string,
  env: Record<string, string> = {},
): Promise<RuntimeBox> {
  probeDirective(null);
  return startRuntimeH2a(name, worker, {
    providers: PROVIDER,
    hubUrl,
    env: { ...H3A_RT_ENV, ...env },
  });
}

/** DB sạch + fixture H1/H2a/H2b + hub-api + Runtime `fake-cli` có env probe H3a; file chỉ thị vắng.
 * `test:h3a:stack` đặt `HUB_ATTACH_DRIVER=local` ⇒ hub cần `HUB_ATTACH_DIR` tuyệt đối (mẫu H2c `stack/_stack.ts`). */
export function bootStackH3a(rtName: string, env: Record<string, string> = {}): Promise<StackH2b> {
  process.env.HUB_ATTACH_DIR = mkdtempSync(join(tmpdir(), "qc-h3a-stack-"));
  probeDirective(null);
  return bootStackH2b(rtName, { ...H3A_RT_ENV, ...env });
}

export type ProviderRow = {
  status: string;
  cooldown_until: Date | null;
  last_probe_at: Date | null;
  rate_limit_type: string | null;
};
export async function providerRow(sql: Sql): Promise<ProviderRow | undefined> {
  const [r] = await sql<ProviderRow[]>`select status, cooldown_until, last_probe_at, rate_limit_type
    from hub.provider_state where provider_key = ${PROVIDER}`;
  return r ? { ...r } : undefined;
}

/** F5/TC-6: đưa `provider_state` về `ok` (không rò `cooldown` sang suite stack khác) + xoá file chỉ thị. */
export async function resetProviderStack(sql: Sql): Promise<void> {
  await sql`update hub.provider_state set status = 'ok', cooldown_until = null, consecutive_errors = 0,
    updated_at = now() where provider_key = ${PROVIDER}`;
  probeDirective(null);
}

export type JobRowS = {
  status: string;
  attempts: number;
  error_code: string | null;
  error_reason: string | null;
};
export const jobsOfRunS = (sql: Sql, runId: string): Promise<JobRowS[]> =>
  sql<JobRowS[]>`select status, attempts, error_code, error_reason from hub.jobs
    where run_id = ${runId} order by created_at, id`.then((rs) => rs.map((r) => ({ ...r })));
