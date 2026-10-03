// ADM-FR-53 · NOTIFY `config_changed` sau commit, đúng một lần (plan M3 §5.2, TECH-DEBT #13). Listener = kết nối riêng
// đóng vai Hub. Âm tính chứng minh bằng sentinel (ghi chắc chắn bump rồi chờ nó), không ngủ cố định.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ConfigChangedPayload, ConfigChangedPayloadSchema } from "@ai/contracts";
import { createDb, type Db, runMigrations, withScope } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { auditOf, recordAudit } from "../audit/audit.write";
import { configWrite } from "./config-write";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const listener = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 3 });
const call = (d: Db = db, hooks?: Parameters<typeof configWrite>[0]["ctx"]["hooks"]) => ({
  ctx: { db: d, hooks },
  scope: { kind: "platform" } as const,
});
const msgs: { at: number; p: ConfigChangedPayload }[] = [];
const ev = { entity: "secret", tenantId: null } as const;
const cfg = async () =>
  (await owner<{ v: number }[]>`select config_version as v from admin.config_meta`)[0]?.v ?? -1;

async function waitFor(pred: () => boolean, ms = 1000): Promise<void> {
  const end = performance.now() + ms;
  while (!pred()) {
    if (performance.now() > end) throw new Error("NOTIFY: quá hạn chờ");
    await Bun.sleep(5);
  }
}

/** Ghi sentinel (bump chắc chắn), chờ nó tới; trả payload đến trước sentinel kể từ `from`. */
async function settle(from: number): Promise<ConfigChangedPayload[]> {
  await configWrite(call(), "group.save", async (_tx, ch) =>
    ch.changed({ entity: "command", tenantId: null }),
  );
  const v = await cfg();
  await waitFor(() => msgs.some((m) => m.p.v === v));
  return msgs
    .slice(
      from,
      msgs.findIndex((m) => m.p.v === v),
    )
    .map((m) => m.p);
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await listener.listen("config_changed", (raw) => {
    msgs.push({ at: performance.now(), p: ConfigChangedPayloadSchema.parse(JSON.parse(raw)) });
  });
});
afterAll(async () => {
  await listener.end({ timeout: 1 });
  await owner.end();
  await db.close();
});

describe("ADM-FR-53 · configWrite + NOTIFY sau commit (M3-R16)", () => {
  test("ghi có đổi → đúng 1 NOTIFY ≤ 1 s, v = config_version, payload không lộ dữ liệu", async () => {
    const from = msgs.length;
    const t0 = performance.now();
    await configWrite(call(), "secret.save", async (_tx, ch) => ch.changed(ev));
    const v = await cfg();
    await waitFor(() => msgs.length > from);
    expect((msgs[from]?.at ?? Number.POSITIVE_INFINITY) - t0).toBeLessThan(1000);
    expect(msgs[from]?.p).toEqual({ v, entity: "secret" });
    expect(await settle(from + 1)).toEqual([]);
  });

  test("no-op, lỗi luật (rollback), retry 40P01 → không NOTIFY thừa", async () => {
    const from = msgs.length;
    await configWrite(call(), "secret.save", async () => 0);
    // try/catch thay `expect(p).rejects`: Bun 1.3.14 treo khi `rejects` chờ promise của transaction postgres.js.
    const failed = await configWrite(call(), "secret.save", async (_tx, ch) => {
      ch.changed(ev);
      throw new Error("luật");
    }).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(failed).toBe("luật");
    let n = 0;
    const hooks = {
      afterLock: async () => {
        n += 1;
        if (n === 1) throw Object.assign(new Error("test deadlock"), { code: "40P01" });
      },
    };
    await configWrite(call(db, hooks), "group.save", async (_tx, ch) =>
      ch.changed({ entity: "group", tenantId: null }),
    );
    expect(n).toBe(2);
    expect((await settle(from)).map((p) => p.entity)).toEqual(["group"]);
  });

  test("Db.notify ném → configWrite vẫn trả kết quả (đã commit), không ném", async () => {
    const broken: Db = { ...db, notify: () => Promise.reject(new Error("notify hỏng")) };
    const before = await cfg();
    const r = await configWrite(call(broken), "secret.save", async (_t, ch) => {
      ch.changed(ev);
      return "done";
    });
    expect(r).toBe("done");
    expect(await cfg()).toBe(before + 1);
  });
});

const PLATFORM = "01900000-0000-7000-8000-0000000c0001";
const ROOT = "01900000-0000-7000-8000-0000000c0002";
const actorCall = (hooks?: Parameters<typeof configWrite>[0]["ctx"]["hooks"]) => ({
  ...call(db, hooks),
  actor: { userId: ROOT },
});
type AuditRow = {
  action: string;
  entity: string;
  entity_name: string;
  actor_id: string | null;
  actor_username: string | null;
  config_version: number | null;
  before: unknown;
  after: unknown;
  snapshot: boolean;
};
const auditsAfter = async (seq: number): Promise<AuditRow[]> => [
  ...(await owner<AuditRow[]>`select action, entity, entity_name, actor_id, actor_username,
    config_version, before, after, snapshot from admin.audit_log where seq > ${seq} order by seq`),
];
const lastSeq = async () =>
  (await owner<{ m: number }[]>`select coalesce(max(seq), 0)::int as m from admin.audit_log`)[0]
    ?.m ?? 0;
/** Hook ném 40P01 ở lần bump đầu → `withScope` thử lại. */
function deadlockOnce() {
  let n = 0;
  const hooks = {
    afterLock: async () => {
      n += 1;
      if (n === 1) throw Object.assign(new Error("test deadlock"), { code: "40P01" });
    },
  };
  return { hooks, calls: () => n };
}
async function seedActor(): Promise<void> {
  await owner`insert into admin.tenants (id, key, name) values (${PLATFORM}, 'platform', 'P')
    on conflict do nothing`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${ROOT}, ${PLATFORM}, 'root', 'h', 'R', 'platform_admin') on conflict do nothing`;
}
const secretAudit = (name: string) =>
  auditOf("create", "secret", {
    entityId: null,
    entityName: name,
    tenantId: null,
    before: null,
    after: { name, note: null, value: "sk-LEAK", last4: "LEAK" },
  });

describe("ADM-FR-51 · M4-R10 · audit trong configWrite (sau bump, cùng tx)", () => {
  beforeAll(seedActor);

  test("2 ch.audit + changed → 2 hàng, config_version = v mới, actor_username snapshot, allowlist lọc giá trị", async () => {
    const from = await lastSeq();
    await configWrite(actorCall(), "secret.save", async (_tx, ch) => {
      ch.changed(ev);
      ch.audit(secretAudit("A_KEY"));
      ch.audit({ ...secretAudit("B_KEY"), snapshot: true });
    });
    const v = await cfg();
    const rows = await auditsAfter(from);
    expect(rows).toEqual([
      expect.objectContaining({ entity_name: "A_KEY", config_version: v, snapshot: false }),
      expect.objectContaining({ entity_name: "B_KEY", config_version: v, snapshot: true }),
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({
        action: "create",
        entity: "secret",
        actor_id: ROOT,
        actor_username: "root",
      });
      expect(r.before).toBeNull();
      expect(r.after).toEqual({ name: r.entity_name, note: null });
    }
  });

  test("rollback → không audit; retry 40P01 → audit của lần hỏng bị bỏ (đúng 1 hàng)", async () => {
    const from = await lastSeq();
    const failed = await configWrite(actorCall(), "secret.save", async (_tx, ch) => {
      ch.changed(ev);
      ch.audit(secretAudit("ROLLED"));
      throw new Error("luật");
    }).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(failed).toBe("luật");
    const d = deadlockOnce();
    await configWrite(actorCall(d.hooks), "secret.save", async (_tx, ch) => {
      ch.changed(ev);
      ch.audit(secretAudit("RETRIED"));
    });
    expect(d.calls()).toBe(2);
    expect((await auditsAfter(from)).map((r) => r.entity_name)).toEqual(["RETRIED"]);
  });
});

describe("ADM-FR-51 · M4-R10 · audit: thiếu actor, tx không bump", () => {
  beforeAll(seedActor);

  test("ch.audit mà ConfigCall thiếu actor → ném, rollback (không bump, không audit)", async () => {
    const from = await lastSeq();
    const before = await cfg();
    const failed = await configWrite(call(), "secret.save", async (_tx, ch) => {
      ch.changed(ev);
      ch.audit(secretAudit("NO_ACTOR"));
    }).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(failed).toContain("actorId");
    expect(await cfg()).toBe(before);
    expect(await auditsAfter(from)).toEqual([]);
  });

  test("recordAudit (tx không bump) → config_version NULL, actor_username snapshot", async () => {
    const from = await lastSeq();
    const before = await cfg();
    await withScope(db, { kind: "platform" }, (tx) =>
      recordAudit(tx, { ...secretAudit("NO_BUMP"), action: "update", actorId: ROOT }),
    );
    expect(await cfg()).toBe(before);
    expect(await auditsAfter(from)).toEqual([
      expect.objectContaining({
        action: "update",
        entity_name: "NO_BUMP",
        config_version: null,
        actor_username: "root",
      }),
    ]);
  });
});

// Đo hiệu năng không chặn mốc (người dùng 2026-10-03): chỉ chạy trong `bun run test:perf` (PERF=1).
describe.skipIf(!process.env.PERF)("ADM-FR-53 · chi phí bump + NOTIFY (spec M3 §6)", () => {
  // Hai nhánh cùng UPDATE một hàng không phải cấu hình: mọi configWrite thật đều đã ghi dữ liệu, nên chi phí commit
  // tx có ghi (WAL flush) là của câu ghi, không phải của bump. So nhánh chỉ đọc sẽ tính nhầm phần đó vào bump.
  beforeAll(async () => {
    await owner`create table if not exists public.config_write_perf (id int primary key, n bigint not null)`;
    await owner`insert into public.config_write_perf values (1, 0) on conflict do nothing`;
    await owner`grant select, update on public.config_write_perf to admin_api`;
  });
  afterAll(async () => {
    await owner`drop table if exists public.config_write_perf`;
  });

  test("≤ 5 ms/ghi: trung vị của hiệu từng cặp (ghi, ghi + bump) chạy xen kẽ 50 lần — bớt nhiễu khi máy bận", async () => {
    const once = async (bump: boolean) => {
      const t = performance.now();
      await configWrite(call(), "secret.save", async (tx, ch) => {
        await tx.execute(sql`update public.config_write_perf set n = n + 1 where id = 1`);
        if (bump) ch.changed(ev);
      });
      return performance.now() - t;
    };
    const diffs: number[] = [];
    for (let i = 0; i < 50; i++) diffs.push((await once(true)) - (await once(false)));
    const median = diffs.sort((x, y) => x - y)[25] ?? 0;
    expect(median).toBeLessThan(5);
  });
});
