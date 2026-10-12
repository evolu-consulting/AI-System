// HUB-FR-104…118 · ADM-FR-71 · e2e P-b2 (test-plan §4) · dựng stack = stack P-a THẬT (`e2e/P-a/_pa-stack.ts`: reset DB riêng
// → migrate Hub tới bản mới nhất trên nhánh → `hub:seed` → persona/Group/agent P-a → admin-api → hub-api → Runtime giả
// `_pa-runtime.ts` ở `/rt/*`) rồi chèn SQL dữ liệu P-b2 (Group "Kiểm thử P-b2" + 4 def có `step`) và mở cổng "đã seed".
// Runtime giả P-a claim MỌI job `queued` của stage (≤ 10/nhịp, kịch bản theo `stage_idx`) ⇒ 2–3 job cùng bước chạy được (G9).
// Run seed (a)…(d) dựng trong ca (`_pb2-support.seedPb2Run`). SIGTERM/SIGINT dừng cả stack con.
import { resolve } from "node:path";
import postgres from "postgres";
import { ACME, PB2_DEFS, PB2_E2E, PERSONA } from "./_pb2-data";

const REPO = resolve(import.meta.dir, "../..");
const env = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (e2e/P-b2/playwright.pb2.config.ts truyền xuống)`);
  return v;
};

async function waitReady(url: string, proc: Bun.Subprocess): Promise<void> {
  const until = Date.now() + 280_000;
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error(`stack P-a thoát (exit ${proc.exitCode})`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok) return;
    } catch {
      // chưa nghe cổng
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} không sẵn sàng`);
}

async function seedPb2(): Promise<void> {
  const sql = postgres(env("TEST_DATABASE_URL"), { max: 1, onnotice: () => {} });
  try {
    await sql`insert into admin.groups (id, tenant_id, key, name)
      values (${PB2_E2E.gTest}, ${ACME}, 'kiem-thu-pb2', ${sql.json({ vi: "Kiểm thử P-b2", en: "Testing P-b2" })})
      on conflict do nothing`;
    await sql`insert into admin.group_members (tenant_id, group_id, user_id)
      values (${ACME}, ${PB2_E2E.gTest}, ${PERSONA.T.id}) on conflict do nothing`;
    const [t] = await sql<
      { t: string | null }[]
    >`select to_regclass('hub.process_defs')::text as t`;
    if (t?.t)
      for (const d of PB2_DEFS)
        await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
            token_budget, enabled, version)
          values (${d.id}, ${ACME}, ${d.key}, ${d.name}, ${`Quy trình e2e P-b2 ${d.name}.`}, 'Số hoá đơn', '{}'::uuid[],
            ${sql.json(d.stages as unknown as postgres.JSONValue)}, null, true, 1)
          on conflict do nothing`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  const child = Bun.spawn([process.execPath, "e2e/P-a/_pa-stack.ts"], {
    cwd: REPO,
    env: { ...process.env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const stop = (): void => {
    child.kill();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await waitReady(`http://localhost:${env("PA_READY_PORT")}/`, child);
  await seedPb2();
  Bun.serve({ port: Number(env("PB2_SEEDED_PORT")), fetch: () => new Response("ok") });
  console.log(`[pb2] sẵn sàng (seed P-b2) :${env("PB2_SEEDED_PORT")}`);
}
