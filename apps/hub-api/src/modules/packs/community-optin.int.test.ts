// CR-120 · cr120-review-fixes · duyệt bài là OPT-IN trên DB thật: tenant mới bật Community ⇒ KHÔNG có luật mặc định ⇒ moderation tắt;
// platform admin gán ⇒ bật; bỏ gán ⇒ tắt (và `ensureSlotDefaults` không cấp lại). Backfill hub 0094 gỡ đúng luật do cấp tự động
// (không đụng thứ admin đã gán), chạy lại vô hại. Kèm: gán khi 50 luật đã đầy ⇒ 409 (không im lặng).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { enablePack, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { AppError } from "../../lib/errors";
import { deleteAssignment, upsertAssignment } from "../processes/library/slot-assign.repo";
import { defaultSlotsOf, ensureSlotDefaults } from "../processes/library/slot-defaults";
import { SLOT_MODERATION } from "./community/domain/flow.rules";
import { communitySlotSpecs } from "./community/domain/flow-slots.rules";
import { communityFlowPorts } from "./community-flow.mount";

let sql: Sql;
let db: Db;
let defId = "";
let actor = "";
let T: string[] = [];
const on = (t: string) => communityFlowPorts(db, undefined).moderationOn?.(t) as Promise<boolean>;
const specs = communitySlotSpecs();
/** Cũ (trước khi opt-in): cùng danh sách khe nhưng không đánh dấu opt-in ⇒ `ensureSlotDefaults` cấp mặc định. */
const legacyList = () => specs.map((s) => ({ ...s, optIn: false }));
const sys = <R>(fn: (tx: Parameters<Parameters<typeof withHubScope>[2]>[0]) => Promise<R>) =>
  withHubScope(db, { kind: "system" }, fn as never) as Promise<R>;
const rows = async (t: string) => ({
  rules: Number(
    (
      await sql`select count(*) from hub.process_routing_rules where tenant_id = ${t}::uuid and slot = ${SLOT_MODERATION}`
    )[0]?.count,
  ),
  heads: Number(
    (
      await sql`select count(*) from hub.process_routings where tenant_id = ${t}::uuid and slot = ${SLOT_MODERATION}`
    )[0]?.count,
  ),
  defs: Number(
    (
      await sql`select count(*) from hub.process_tenant_defs where tenant_id = ${t}::uuid and slot = ${SLOT_MODERATION}`
    )[0]?.count,
  ),
});
const migration = () =>
  readFileSync(
    new URL(
      "../../../../../packages/db/migrations-hub/0094_community_slots_optin.sql",
      import.meta.url,
    ),
    "utf8",
  ).split("--> statement-breakpoint");
const runBackfill = async () => {
  for (const s of migration()) await sql.unsafe(s);
};

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  db = createDb(urls().hubApi, { max: 2 });
  T = await tenants(sql, 6, 71);
  await enablePack(sql, T, "community");
  actor = (await users(sql, T[0] as string, 1, { from: 71 }))[0] as string;
  const [d] =
    await sql`select default_def_id::text as id from hub.process_slots where slot = ${SLOT_MODERATION}`;
  defId = d?.id as string;
  expect(defId, "hub 0092 gieo mẫu khe duyệt bài").toBeTruthy();
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("duyệt bài opt-in [CR-120]", () => {
  it("tenant mới bật Community ⇒ không cấp mặc định ⇒ moderation tắt, gán ⇒ bật, bỏ gán ⇒ tắt và không bị cấp lại", async () => {
    const t = T[0] as string;
    expect(
      await ensureSlotDefaults(
        db,
        defaultSlotsOf(() => specs),
        [t],
      ),
    ).toBe(0);
    expect(await rows(t)).toEqual({ rules: 0, heads: 0, defs: 0 });
    expect(await on(t)).toBe(false);
    await sys((tx) =>
      upsertAssignment(tx, { tenantId: t, slot: SLOT_MODERATION, defId, actorId: actor }),
    );
    expect(await on(t)).toBe(true);
    await sys((tx) => deleteAssignment(tx, t, SLOT_MODERATION));
    await ensureSlotDefaults(
      db,
      defaultSlotsOf(() => specs),
      [t],
    );
    expect(await on(t)).toBe(false);
  });

  it("đối chứng: danh sách khe KHÔNG opt-in thì cấp mặc định (đúng lỗi cũ) ⇒ moderation bật ngầm", async () => {
    const t = T[1] as string;
    expect(await ensureSlotDefaults(db, defaultSlotsOf(legacyList), [t])).toBeGreaterThan(0);
    expect(await on(t)).toBe(true);
  });

  it("backfill 0094: gỡ luật do cấp tự động, GIỮ luật admin gán/sửa, chạy lại vô hại", async () => {
    const [auto, assigned, edited] = [T[2], T[3], T[4]] as [string, string, string];
    await ensureSlotDefaults(db, defaultSlotsOf(legacyList), [auto, assigned, edited]);
    // admin gán trên nền luật tự cấp ⇒ đầu luật có updated_by + version 2
    await sys((tx) =>
      upsertAssignment(tx, {
        tenantId: assigned,
        slot: SLOT_MODERATION,
        defId,
        actorId: actor,
      }),
    );
    // admin sửa đầu luật (đường PUT luật): version tăng + updated_by
    await sql`update hub.process_routings set version = 2, updated_by = ${actor}::uuid where tenant_id = ${edited}::uuid and slot = ${SLOT_MODERATION}`;
    expect(await rows(auto)).toEqual({ rules: 1, heads: 1, defs: 1 });
    await runBackfill();
    expect(await rows(auto)).toEqual({ rules: 0, heads: 0, defs: 0 });
    expect(await rows(assigned)).toEqual({ rules: 1, heads: 1, defs: 1 });
    expect(await rows(edited)).toEqual({ rules: 1, heads: 1, defs: 1 });
    await runBackfill(); // chạy lại ⇒ không đổi
    expect(await rows(assigned)).toEqual({ rules: 1, heads: 1, defs: 1 });
    expect(await on(auto)).toBe(false);
    expect(await on(assigned)).toBe(true);
  });

  it("gán khi 50 luật đã đầy ⇒ 409 ROUTING_RULES_FULL, không đổi gì (tx hoàn tác)", async () => {
    const t = T[5] as string;
    await sql`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${t}::uuid, ${defId}::uuid, ${SLOT_MODERATION})`;
    await sql`insert into hub.process_routings (tenant_id, slot) values (${t}::uuid, ${SLOT_MODERATION})`;
    await sql`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
      select ${t}::uuid, ${SLOT_MODERATION}, g, '{}'::jsonb, ${defId}::uuid, false from generate_series(0, 49) g`;
    const err = await sys((tx) =>
      upsertAssignment(tx, { tenantId: t, slot: SLOT_MODERATION, defId, actorId: actor }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 409, code: "ROUTING_RULES_FULL" });
    const [h] =
      await sql`select version from hub.process_routings where tenant_id = ${t}::uuid and slot = ${SLOT_MODERATION}`;
    expect(h?.version).toBe(1);
    expect((await rows(t)).rules).toBe(50);
  });
});
