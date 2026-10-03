// ADM-FR-52, ADM-NFR-07 · plan M4 §6 "Restore": khôi phục command đi đúng chuỗi khoá PATCH (workflow SHARE → command
// NKU) → Restore ∥ Command PATCH xen kẽ tất định: không deadlock, bên sau thấy VERSION_CONFLICT.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { barrier, codeOf, lockKit } from "../../lib/lock-order.helpers";
import type { TestHooks } from "../../lib/test-hooks";
import { createCommand, updateCommand } from "../commands/commands.service";
import { createWorkflow } from "../workflows/workflows.service";
import { restoreAudit } from "./audit.restore";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const n = (k: number) => `01900000-0000-7000-8000-0000000de${String(k).padStart(3, "0")}`;
const [TID, ADMIN, F1, SEC] = [n(1), n(2), n(3), n(4)];
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 6 });
const { interleave } = lockKit(owner);
const call = (hooks?: TestHooks) => ({
  ctx: { db, now: () => new Date(), hooks },
  scope: { kind: "platform" } as const,
  actor: { userId: ADMIN, tenantId: TID, tenantKey: "lockr", role: "platform_admin", sid: null },
});
// biome-ignore lint/suspicious/noExplicitAny: Actor đầy đủ không cần cho luồng khoá
const c = (hooks?: TestHooks) => call(hooks) as any;
const verOf = async (id: string) =>
  Number((await owner`select version as v from admin.commands where id = ${id}`)[0]?.v);

let CMD = "";
let ENTRY = "";

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`truncate admin.commands, admin.workflows, admin.features, admin.secrets, admin.users,
    admin.tenants cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'lockr', 'Lock R')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${ADMIN}, ${TID}, 'boss', 'h', 'Boss', 'platform_admin')`;
  await owner`insert into admin.features (id, key, name) values (${F1}, 'f-r', '{"vi":"F"}')`;
  await owner`insert into admin.secrets (id, name, ciphertext, iv, last4)
    values (${SEC}, 'LOCK_R', ${Buffer.alloc(24)}, ${Buffer.alloc(12)}, 'abcd')`;
  const wf = await createWorkflow(c(), {
    key: "wf-r",
    name: "WF R",
    description: "d".repeat(30),
    app_type: "workflow",
    base_url: "https://x.example.com",
    secret_id: SEC,
    input_schema: [],
    output_field: null,
    enabled: true,
  });
  const cmd = await createCommand(c(), {
    name: "lockr",
    aliases: [],
    description: { vi: "A" },
    workflow_id: wf.id,
    args: [],
    input_map: {},
    output: { field: "text", render: "text" },
    mode: "sync",
    enabled: true,
    feature_ids: [F1],
  });
  CMD = cmd.id;
  await updateCommand(c(), CMD, { version: cmd.version, description: { vi: "B" } });
  const [e] = await owner<{ id: string }[]>`select id from admin.audit_log
    where entity = 'command' and action = 'update' and entity_id = ${CMD} order by seq desc limit 1`;
  ENTRY = e?.id as string;
});
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("ADM-FR-52 · plan M4 §6 · Restore command ∥ Command PATCH", () => {
  it("RL1 · restore giữ command NKU ∥ PATCH chờ → restore xong (v+1), PATCH VERSION_CONFLICT; 0 deadlock", async () => {
    const v = await verOf(CMD);
    const b = barrier("command.save");
    const r = await interleave(
      () => restoreAudit(c(b.hooks), ENTRY),
      () => updateCommand(c(), CMD, { version: v, description: { vi: "C" } }),
      b,
    );
    expect([r.ra.ok, codeOf(r.rb), await verOf(CMD), r.deadlocks]).toEqual([
      true,
      "VERSION_CONFLICT",
      v + 1,
      0,
    ]);
  });

  it("RL2 · PATCH giữ command NKU ∥ restore chờ → PATCH xong, restore VERSION_CONFLICT; 0 deadlock", async () => {
    const v = await verOf(CMD);
    const b = barrier("command.save");
    const r = await interleave(
      () => updateCommand(c(b.hooks), CMD, { version: v, description: { vi: "C" } }),
      () => restoreAudit(c(), ENTRY),
      b,
    );
    expect([r.ra.ok, codeOf(r.rb), await verOf(CMD), r.deadlocks]).toEqual([
      true,
      "VERSION_CONFLICT",
      v + 1,
      0,
    ]);
  });
});
