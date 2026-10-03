// ADM-FR-41 · AC-A12 · Q2b · admin-api thật (spawn, cổng 3094) + Mailpit: Hub ghi usage + NOTIFY quota_threshold →
// evaluator gửi mail 100 % (test-plan AL10; plan §7). Server con kế thừa `...process.env` (như M2 secrets-proc).
// Tên tenant đổi thành tên riêng của lần chạy để lọc thư trên Mailpit dùng chung. Xanh ở T4.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  ADMIN_API_URL,
  auditMark,
  createM4Env,
  insertUsage,
  type M4Env,
  poll,
  setQuota,
  TENANT_ID,
} from "./_ab";
import { mailpitFind, mailpitMessage } from "./_cd";
import { ROOT } from "./_modules";

const PORT = 3094;
const BASE = `http://localhost:${PORT}`;
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;
let env: M4Env;
let proc: ReturnType<typeof Bun.spawn> | undefined;
let RUN = "";

function childEnv(): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    PORT: String(PORT),
    APP_ENV: "test",
    CORS_ORIGINS: "http://localhost:3000",
    ADMIN_API_DATABASE_URL: ADMIN_API_URL,
    ADMIN_WEB_URL: "http://localhost:3000",
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) out[k] = v;
  return out;
}
const healthy = async () => (await fetch(`${BASE}/health`).catch(() => null))?.status === 200;

beforeAll(async () => {
  env = await createM4Env();
  await env.reset4();
  RUN = `AL10-${await auditMark(env.owner)}-${Date.now()}`;
  await env.owner`update admin.tenants set name = ${`Acme ${RUN}`} where id = ${A}`;
  await env.owner`update admin.tenants set name = ${`Globex ${RUN}`} where id = ${G}`;
  proc = Bun.spawn(["bun", "apps/admin-api/src/server.ts"], {
    cwd: ROOT,
    env: childEnv(),
    stdout: "ignore",
    stderr: "ignore",
  });
});
afterAll(async () => {
  proc?.kill();
  await proc?.exited;
  await env.close();
});

const subject = (name: string, pct: number) => `[${name} ${RUN}] Đã dùng ${pct}% quota tháng`;
async function recipients(subj: string): Promise<string[]> {
  const out: string[] = [];
  for (const m of await mailpitFind(subj)) {
    const full = await mailpitMessage(m.ID);
    for (const t of full.To ?? []) out.push(t.Address);
  }
  return out.sort();
}

describe("ADM-FR-41 · AC-A12 · proc + Mailpit", () => {
  it("ADM-FR-41 · AC-A12 · AL10 · quota 1000, 999 run; Hub chèn 2 run (hàng 1001 overage) + NOTIFY → đúng 1 mail 100% cho binh, 1 cho chi; NOTIFY hỏng 'x' rồi globex hợp lệ → server sống, acme không thêm mail", async () => {
    await poll(healthy, true, 20_000);
    await setQuota(env.owner, A, null, { runs: 1000 });
    await insertUsage(env.owner, 999, { tenant: A, runFrom: 0 });
    await insertUsage(env.owner, 2, { tenant: A, runFrom: 999, overage: 1 });
    const [ov] =
      await env.owner`select count(*)::int as n from hub.usage_logs where tenant_id = ${A} and overage`;
    expect(ov?.n).toBe(1);
    await env.notifyQuota(A);
    await poll(async () => (await recipients(subject("Acme", 100))).length, 2, 15_000);
    expect(await recipients(subject("Acme", 100))).toEqual(["binh@acme.test", "chi@acme.test"]);
    expect(await mailpitFind(subject("Acme", 80))).toHaveLength(0);
    // NOTIFY hỏng rồi sentinel globex hợp lệ
    await env.owner`select pg_notify('quota_threshold', 'x')`;
    await setQuota(env.owner, G, null, { runs: 100 });
    await insertUsage(env.owner, 90, { tenant: G, runFrom: 5000 });
    await env.notifyQuota(G);
    await poll(async () => (await recipients(subject("Globex", 80))).length, 1, 15_000);
    expect(await healthy()).toBe(true);
    expect(await recipients(subject("Acme", 100))).toHaveLength(2);
    expect(await mailpitFind(subject("Acme", 80))).toHaveLength(0);
    const [al] =
      await env.owner`select count(*)::int as n from admin.quota_alerts where tenant_id = ${A} and status = 'sent'`;
    expect(al?.n).toBe(1);
  });
});
