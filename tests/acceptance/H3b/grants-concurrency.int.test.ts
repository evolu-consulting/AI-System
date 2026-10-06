// HUB-FR-78 · H3b-R06, R08 · HUB-H3b-AC-05 · plan §6 · test-plan-cases H3b §2.3 A45–A51: ghi grant đồng thời — rào bằng khoá
// `config_meta` (F1), thứ tự khoá `config_meta → agent_grants → audit_log`, seed ∥ POST không deadlock (PL3, G8).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runHubSeed } from "../../../apps/hub-api/src/modules/seed/seed";
import { OWNER_URL, type Res, waitFor } from "../H1/_fixtures";
import { hubConfigChange, pgDeadlocks } from "../H1/_hub";
import {
  AGT,
  auditSince,
  type Ctx,
  delGrant,
  GRP,
  type GrantRef,
  grantRow,
  holdConfigMeta,
  listenHub,
  lockWaiters,
  type Notes,
  postGrant,
  startH3b,
  stateOf,
  T,
  USERS,
  versionOf,
} from "./_h3b";

let x: Ctx;
let n: Notes;
beforeAll(async () => {
  x = await startH3b();
  n = await listenHub();
}, 60_000);
afterAll(async () => {
  await n?.close();
  await x?.stop();
});

const G: GrantRef = { agent: AGT.hoadon, type: "group", subject: GRP.keToan };
const ROUNDS = 10;
const dropRow = (g: GrantRef) =>
  x.sql`delete from hub.agent_grants where tenant_id = ${T.acme} and agent_id = ${g.agent}
    and subject_type = ${g.type} and subject_id = ${g.subject}`;

/** F1: giữ `config_meta`, bắn `ops`, chờ đủ `ops.length` backend `hub_api` chờ khoá (≤ 5 s), nhả, trả kết quả. */
async function barrier(ops: (() => Promise<Res>)[]): Promise<{ res: Res[]; waiters: number }> {
  const release = await holdConfigMeta(x.sql);
  let pending: Promise<Res[]> | undefined;
  let waiters = 0;
  try {
    pending = Promise.all(ops.map((op) => op()));
    waiters = await waitFor(
      () => lockWaiters(x.sql),
      (w) => w >= ops.length,
      5_000,
    );
  } finally {
    await release();
  }
  return { res: await pending, waiters };
}

describe("A45–A46 · cùng khoá song song [HUB-FR-78 · H3b-R06, R08 · HUB-H3b-AC-05]", () => {
  it("HUB-FR-78 · A45 · ×10: 2 POST cùng khoá (rào config_meta) ⇒ {201, 200}, cùng id, 1 hàng, v+1 đúng 1, 1 audit, 1 NOTIFY mỗi vòng [H3b-R06 · AC-05]", async () => {
    for (let i = 0; i < ROUNDS; i++) {
      await dropRow(G);
      const s0 = await stateOf(x.sql);
      const m = n.mark();
      const { res, waiters } = await barrier([
        () => postGrant(x, "tadmin", G),
        () => postGrant(x, "tadmin", G),
      ]);
      expect({ i, waiters }).toEqual({ i, waiters: 2 });
      expect(res.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(res[0]?.json?.grant?.id).toBe(res[1]?.json?.grant?.id);
      const [c] = await x.sql<{ c: number }[]>`select count(*)::int as c from hub.agent_grants
        where tenant_id = ${T.acme} and agent_id = ${G.agent} and subject_id = ${G.subject}`;
      expect(c?.c).toBe(1);
      expect(await versionOf(x.sql)).toBe(s0.version + 1);
      expect((await auditSince(x.sql, s0.audit)).length).toBe(1);
      await n.sentinel();
      expect(n.since(m).length).toBe(1);
    }
  }, 120_000);

  it("HUB-FR-78 · A46 · ×10: POST ∥ DELETE cùng khoá (rào) ⇒ không 500, deadlock Δ0; hàng còn ⇔ thao tác commit sau là POST; Δversion = Δaudit = số NOTIFY [H3b-R06, R07 · AC-05]", async () => {
    const d0 = await pgDeadlocks(x.sql);
    for (let i = 0; i < ROUNDS; i++) {
      await dropRow(G);
      const s0 = await stateOf(x.sql);
      const m = n.mark();
      const { res, waiters } = await barrier([
        () => postGrant(x, "tadmin", G),
        () => delGrant(x, "tadmin", G),
      ]);
      expect({ i, waiters }).toEqual({ i, waiters: 2 });
      expect(res.map((r) => r.status).filter((s) => s >= 500)).toEqual([]);
      const audits = await auditSince(x.sql, s0.audit);
      const last = audits.at(-1)?.action;
      expect({ i, exists: (await grantRow(x.sql, T.acme, G)) !== undefined }).toEqual({
        i,
        exists: last === "grant",
      });
      await n.sentinel();
      const dv = (await versionOf(x.sql)) - s0.version;
      expect({ dv, da: audits.length, dn: n.since(m).length }).toEqual({ dv, da: dv, dn: dv });
      expect(dv).toBeGreaterThan(0);
    }
    expect((await pgDeadlocks(x.sql)) - d0).toBe(0);
  }, 120_000);
});

/** Bản sao seed mặc định + `access.yaml`/`agents.yaml` riêng: entitlement hoadon/acme + grant hoadon → group kho. */
function seedDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "qc-h3b-seed-"));
  cpSync(resolve(import.meta.dir, "../../../apps/hub-api/seed"), dir, { recursive: true });
  writeFileSync(
    join(dir, "agents.yaml"),
    [
      "agents:",
      "  - key: orchestrator",
      "    name: { vi: Điều phối, en: Orchestrator }",
      "    description: Điều phối yêu cầu tới agent phù hợp (seed thử H3b).",
      "    runtime: agentic-cli",
      "    profile: fake-1",
      "    system_prompt: Bạn là bộ điều phối.",
      "  - key: hoadon",
      "    name: { vi: Hoá đơn, en: Invoice }",
      "    description: Tra cứu và tổng hợp hoá đơn của doanh nghiệp.",
      "    runtime: agentic-cli",
      "    profile: fake-1",
      "orchestrator:",
      "  agent: orchestrator",
      "  max_steps: 5",
      "  token_budget: 200000",
      "  history_n: 10",
      "  on_no_match: answer",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "access.yaml"),
    [
      "entitlements:",
      "  - { agent: hoadon, tenant_key: acme }",
      "grants:",
      "  - { agent: hoadon, tenant_key: acme, subject: 'group:kho' }",
      "",
    ].join("\n"),
  );
  return dir;
}

describe("A47–A48 · seed / cấu hình owner ∥ POST [HUB-FR-78 · H3b-R08 · PL3 · G8]", () => {
  it("HUB-FR-78 · A47 · ×10: POST (khoá khác nhau) ∥ seed thật (YAML hoadon → kho) ⇒ cả hai xong, deadlock Δ0, grant API còn sau seed [H3b-R08 · PL3 · G8]", async () => {
    const dir = seedDir();
    const subjects = [USERS.lan, USERS.hoa, USERS.tam, USERS.nghi, USERS.khoa].map((u) => u.id);
    const keys: GrantRef[] = [AGT.hoadon, AGT.tatt].flatMap((agent) =>
      subjects.map((subject) => ({ agent, type: "user" as const, subject })),
    );
    const d0 = await pgDeadlocks(x.sql);
    try {
      for (const [i, g] of keys.entries()) {
        const [post, seed] = await Promise.all([
          postGrant(x, "tadmin", g),
          runHubSeed({ url: OWNER_URL, dir, appEnv: "test" }).then(
            () => "ok",
            (err: unknown) => `seed lỗi: ${(err as Error).message}`,
          ),
        ]);
        expect({ i, post: post.status, seed }).toEqual({ i, post: 201, seed: "ok" });
        expect({ i, kept: (await grantRow(x.sql, T.acme, g)) !== undefined }).toEqual({
          i,
          kept: true,
        });
      }
      expect(
        await grantRow(x.sql, T.acme, { agent: AGT.hoadon, type: "group", subject: GRP.kho }),
      ).toBeDefined();
      expect((await pgDeadlocks(x.sql)) - d0).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("HUB-FR-78 · A48 · POST ∥ hubConfigChange owner ⇒ cả hai xong; hai version khác nhau liên tiếp [H3b-R08]", async () => {
    const g: GrantRef = { agent: AGT.cliX, type: "group", subject: GRP.kho };
    const v0 = await versionOf(x.sql);
    const [post, vOwner] = await Promise.all([
      postGrant(x, "tadmin", g),
      hubConfigChange(x.sql, async () => {}, false),
    ]);
    expect(post.status).toBe(201);
    const vPost = post.json?.hub_config_version;
    expect([vPost, vOwner].sort((p, q) => p - q)).toEqual([v0 + 1, v0 + 2]);
  });
});

/** Backend `hub_api` đang chờ khoá (pid) + khoá nó đang giữ/chờ theo bảng. */
async function waiterLocks(): Promise<{ pid: number; held: string[]; waiting: string[] }> {
  const [w] = await x.sql<{ pid: number }[]>`select pid from pg_stat_activity
    where datname = current_database() and usename = 'hub_api' and wait_event_type = 'Lock' limit 1`;
  const pid = w?.pid ?? -1;
  const rows = await x.sql<{ rel: string; mode: string; granted: boolean }[]>`
    select coalesce(c.relname, l.locktype) as rel, l.mode, l.granted from pg_locks l
    left join pg_class c on c.oid = l.relation where l.pid = ${pid}
      and (c.relname in ('config_meta', 'agent_grants', 'audit_log') or l.locktype in ('tuple', 'transactionid'))`;
  const fmt = (r: { rel: string; mode: string }) => `${r.rel}:${r.mode}`;
  return {
    pid,
    held: rows.filter((r) => r.granted).map(fmt),
    waiting: rows.filter((r) => !r.granted).map(fmt),
  };
}

/** Độc lập thứ tự: A47 (cùng file) đã cấp qua API cho các user này ⇒ xoá hàng trước khi POST "mới" (R06: trùng ⇒ 200, không khoá audit). */
const dropUserGrant = (agent: string, userId: string) =>
  dropRow({ agent, type: "user", subject: userId });

describe("A49–A51 · thứ tự khoá, khác khoá song song [HUB-FR-78 · plan §6 · HUB-H3b-AC-05]", () => {
  it("HUB-FR-78 · A49 · owner giữ config_meta, POST ⇒ backend chờ config_meta, CHƯA RowExclusiveLock agent_grants; nhả ⇒ 201 [plan §6 · P6]", async () => {
    const g: GrantRef = { agent: AGT.tatt, type: "group", subject: GRP.kho };
    const release = await holdConfigMeta(x.sql);
    let pending: Promise<Res> | undefined;
    try {
      pending = postGrant(x, "tadmin", g);
      expect(
        await waitFor(
          () => lockWaiters(x.sql),
          (c) => c >= 1,
          5_000,
        ),
      ).toBe(1);
      const l = await waiterLocks();
      expect(l.held).not.toContain("agent_grants:RowExclusiveLock");
      expect(l.held.some((h) => h.startsWith("config_meta:"))).toBe(true);
    } finally {
      await release();
    }
    expect((await pending)?.status).toBe(201);
  });

  it("HUB-FR-78 · A50 · owner LOCK audit_log SHARE ROW EXCLUSIVE, POST ⇒ backend chờ audit_log, đang giữ config_meta + RowExclusiveLock agent_grants; nhả ⇒ 201 [plan §6]", async () => {
    const g: GrantRef = { agent: AGT.hoadon, type: "user", subject: USERS.hoa.id };
    await dropUserGrant(g.agent, g.subject);
    const r = await x.sql.reserve();
    await r`begin`;
    await r`lock table hub.audit_log in share row exclusive mode`;
    let pending: Promise<Res> | undefined;
    try {
      pending = postGrant(x, "tadmin", g);
      expect(
        await waitFor(
          () => lockWaiters(x.sql),
          (c) => c >= 1,
          5_000,
        ),
      ).toBe(1);
      const l = await waiterLocks();
      expect(l.waiting.some((w) => w.startsWith("audit_log:"))).toBe(true);
      expect(l.held).toContain("agent_grants:RowExclusiveLock");
      expect(l.held.some((h) => h.startsWith("config_meta:"))).toBe(true);
    } finally {
      await r`commit`;
      r.release();
    }
    expect((await pending)?.status).toBe(201);
  });

  it("HUB-FR-78 · A51 · 2 POST khác khoá song song ⇒ 201 cả hai; version v+1, v+2 khác nhau; 2 audit; 2 NOTIFY [H3b-R08]", async () => {
    const a: GrantRef = { agent: AGT.cliX, type: "user", subject: USERS.tam.id };
    const b: GrantRef = { agent: AGT.tatt, type: "user", subject: USERS.tam.id };
    await dropUserGrant(a.agent, a.subject);
    await dropUserGrant(b.agent, b.subject);
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    const res = await Promise.all([postGrant(x, "tadmin", a), postGrant(x, "tadmin", b)]);
    expect(res.map((r) => r.status)).toEqual([201, 201]);
    expect(res.map((r) => r.json?.hub_config_version).sort((p, q) => p - q)).toEqual([
      s0.version + 1,
      s0.version + 2,
    ]);
    expect((await auditSince(x.sql, s0.audit)).length).toBe(2);
    await n.sentinel();
    expect(n.since(m).length).toBe(2);
  });
});
