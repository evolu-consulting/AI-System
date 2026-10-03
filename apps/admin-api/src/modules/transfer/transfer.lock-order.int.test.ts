// ADM-FR-54, ADM-NFR-07 · plan-cd §8.4 (ngoại lệ E4 · import): Import áp dụng ∥ Command PATCH, Import ∥ Secret PUT xen kẽ
// tất định — không deadlock; import đi sau một ghi cấu hình khác → 409 VERSION_CONFLICT (expectBase).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import type { Actor } from "../../lib/auth-middleware";
import { barrier, codeOf, lockKit } from "../../lib/lock-order.helpers";
import { parseMasterKey } from "../../lib/secret-crypto";
import type { TestHooks } from "../../lib/test-hooks";
import { updateCommand } from "../commands/commands.service";
import { replaceSecret } from "../secrets/secrets.service";
import { applyImport, mapRace } from "./transfer.apply";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const n = (k: number) => `01900000-0000-7000-8000-0000000ee${String(k).padStart(3, "0")}`;
const [TID, ADMIN, SEC, WF, CMD, FEAT] = [n(1), n(2), n(3), n(4), n(5), n(6)];
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 6 });
const key = parseMasterKey(randomBytes(32).toString("base64"));
const { interleave } = lockKit(owner);
const platform = { kind: "platform" } as const;
const actor: Actor = {
  userId: ADMIN,
  tenantId: TID,
  tenantKey: "platform",
  role: "platform_admin",
  sid: null,
} as unknown as Actor;
const call = (hooks?: TestHooks) => ({
  ctx: { db, now: () => new Date(), hooks, secretKey: key },
  scope: platform,
  actor,
});

const wfEl = {
  key: "wf-lock",
  name: "Workflow lock",
  description: "Workflow cho test khoá import (đã sửa)",
  app_type: "workflow",
  base_url: "https://dify.example.com/v1",
  secret: "LOCK_KEY",
  input_schema: [],
  output_field: null,
  enabled: true,
};
const cmdEl = {
  name: "lock-cmd",
  aliases: [],
  description: { vi: "Command khoá — import" },
  workflow: "wf-lock",
  args: [],
  input_map: {},
  output: { field: "text", render: "markdown" },
  mode: "sync",
  timeout_s: 30,
  enabled: true,
};
const content = JSON.stringify({
  format: "ai-system/config",
  format_version: 1,
  config_version: 1,
  exported_at: "2026-10-01T09:00:00.000Z",
  workflows: [wfEl],
  commands: [cmdEl],
});
const cfg = async () =>
  Number((await owner`select config_version as v from admin.config_meta where id = 1`)[0]?.v ?? 0);
const imp = async (hooks?: TestHooks) =>
  applyImport(call(hooks), { file_name: "lock.yaml", content, base_config_version: await cfg() });
const desc = async () =>
  String((await owner`select description from admin.workflows where id = ${WF}`)[0]?.description);

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`truncate admin.feature_commands, admin.command_names, admin.commands, admin.workflows,
    admin.secrets, admin.features, admin.users, admin.tenants, admin.config_meta cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'platform', 'Platform')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${ADMIN}, ${TID}, 'admin', 'h', 'Admin', 'platform_admin')`;
  await owner`insert into admin.secrets (id, name, ciphertext, iv, last4)
    values (${SEC}, 'LOCK_KEY', ${randomBytes(32)}, ${randomBytes(12)}, 'abcd')`;
  await owner`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id)
    values (${WF}, 'wf-lock', 'Workflow lock', 'Workflow cho test khoá import', 'workflow',
      'https://dify.example.com/v1', ${SEC})`;
  await owner`insert into admin.commands (id, name, description, workflow_id, output)
    values (${CMD}, 'lock-cmd', '{"vi":"Command khoá"}', ${WF}, '{"field":"text","render":"markdown"}')`;
  await owner`insert into admin.command_names (name, command_id) values ('lock-cmd', ${CMD})`;
  await owner`insert into admin.features (id, key, name) values (${FEAT}, 'f-lock', '{"vi":"F"}')`;
  await owner`insert into admin.feature_commands (feature_id, command_id) values (${FEAT}, ${CMD})`;
});
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("ADM-FR-54 · plan-cd §8.4 E4 · Import ∥ Command PATCH / Secret PUT", () => {
  it("IL1 · import giữ workflow+command NKU ∥ PATCH command chờ → import xong, PATCH 409 (version đã tăng); 0 deadlock", async () => {
    const b = barrier("import.apply");
    const r = await interleave(
      () => imp(b.hooks),
      () => updateCommand(call(), CMD, { version: 1, enabled: false }),
      b,
    );
    expect([r.ra.ok, codeOf(r.rb), r.deadlocks]).toEqual([true, "VERSION_CONFLICT", 0]);
    expect(await desc()).toBe(wfEl.description);
  });

  it("IL2 · PATCH command giữ khoá ∥ import chờ → PATCH xong, import 409 VERSION_CONFLICT, không ghi; 0 deadlock", async () => {
    const v0 = await cfg();
    const b = barrier("command.save");
    const r = await interleave(
      () => updateCommand(call(b.hooks), CMD, { version: 1, enabled: false }),
      () => imp(),
      b,
    );
    expect([r.ra.ok, codeOf(r.rb), r.deadlocks, await cfg()]).toEqual([
      true,
      "VERSION_CONFLICT",
      0,
      v0 + 1,
    ]);
    expect(await desc()).not.toBe(wfEl.description);
  });

  it("IL3 · import giữ secret SHARE (hạng 12) ∥ Secret PUT chờ → cả hai xong; 0 deadlock", async () => {
    const v0 = await cfg();
    const b = barrier("import.apply");
    const r = await interleave(
      () => imp(b.hooks),
      () => replaceSecret(call(), "LOCK_KEY", "sk-lock-new-value-1234"),
      b,
    );
    expect([r.ra.ok, r.rb.ok, r.deadlocks, await cfg()]).toEqual([true, true, 0, v0 + 2]);
  });
});

describe("ADM-FR-54 · review M4 #3 · mapRace", () => {
  it("TL-R · unique/FK khi config_version không đổi → 409 VERSION_CONFLICT {current} (không 500); lỗi khác ném lại", async () => {
    const cur = Number(
      (await owner`select config_version as v from admin.config_meta where id = 1`)[0]?.v ?? 0,
    );
    const codeOfErr = (err: unknown) =>
      mapRace(call() as never, err).then(
        () => null,
        (e: { code?: string; details?: unknown }) => [e.code, e.details],
      );
    for (const code of ["23505", "23503"])
      expect(await codeOfErr({ code, constraint_name: "x_uq" })).toEqual([
        "VERSION_CONFLICT",
        { current: cur },
      ]);
    const boom = new Error("boom");
    expect(await mapRace(call() as never, boom).catch((e) => e)).toBe(boom);
  });
});
