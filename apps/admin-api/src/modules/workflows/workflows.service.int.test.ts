// ADM-FR-13, ADM-FR-15, ADM-FR-22 · service workflows trên DB thật (role admin_api): chặn tắt/xoá, schema phá command,
// agents_available=false khi admin_rw mất SELECT hub.agent_workflows (GRANT lại trong finally, không DROP).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import {
  type Call,
  createWorkflow,
  deleteWorkflow,
  getWorkflowUsages,
  listWorkflows,
  updateWorkflow,
} from "./workflows.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const id = (n: number) => `01900000-0000-7000-8000-00000000a7${String(n).padStart(2, "0")}`;
const TID = id(1);
const UID = id(2);
const SID = id(3);
const AGENT = id(4);
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 2 });
const call: Call = {
  ctx: { db },
  actor: { userId: UID, tenantId: TID, tenantKey: "platform", role: "platform_admin", sid: null },
  scope: { kind: "platform" },
};
const input = (name: string, required = true) => ({
  name,
  type: "text" as const,
  required,
  description: `Tham số ${name}`,
});
const base = {
  name: "Dịch",
  description: "Dịch văn bản sang ngôn ngữ khác",
  app_type: "workflow" as const,
  base_url: "https://dify.test/v1",
  secret_id: SID,
  output_field: null,
  enabled: true,
};

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'platform', 'P')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${UID}, ${TID}, 'admin', 'h', 'A', 'platform_admin')`;
  await owner`insert into admin.secrets (id, name, ciphertext, iv, last4)
    values (${SID}, 'K_EY', ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, 'abcd')`;
});
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("ADM-FR-13 · workflows.service", () => {
  test("ADM-FR-13 · tắt/xoá bị chặn khi có command bật; schema phá command → SCHEMA_BREAKS_COMMANDS", async () => {
    const w = await createWorkflow(call, {
      ...base,
      key: "tr",
      input_schema: [input("text")],
    });
    expect(w).toMatchObject({ unattached: true, updated_by: "admin", secret: { name: "K_EY" } });
    const cid = id(10);
    await owner`insert into admin.commands (id, name, description, workflow_id, input_map, output)
      values (${cid}, 'dich', '{"vi":"x"}'::jsonb, ${w.id}, '{"text":{"source":"selection"}}'::jsonb,
        '{"field":"t","render":"text"}'::jsonb)`;
    await expect(updateWorkflow(call, w.id, { version: 1, enabled: false })).rejects.toMatchObject({
      code: "WORKFLOW_IN_USE",
      details: { action: "disable" },
    });
    await expect(
      updateWorkflow(call, w.id, { version: 1, input_schema: [input("other")] }),
    ).rejects.toMatchObject({ code: "SCHEMA_BREAKS_COMMANDS" });
    await expect(deleteWorkflow(call, w.id)).rejects.toMatchObject({ code: "WORKFLOW_IN_USE" });
    await owner`delete from admin.commands where id = ${cid}`;
    await deleteWorkflow(call, w.id);
  });

  test("ADM-FR-15 · M2-R12 · admin_rw mất SELECT hub.agent_workflows → agents_available=false, không lỗi", async () => {
    const w = await createWorkflow(call, { ...base, key: "ag", input_schema: [] });
    await owner`insert into hub.agent_workflows (agent_id, workflow_id) values (${AGENT}, ${w.id})`;
    expect(await getWorkflowUsages(call, w.id)).toMatchObject({
      agents: [{ id: AGENT }],
      agents_available: true,
    });
    try {
      await owner.unsafe("revoke select on hub.agent_workflows from admin_rw");
      expect(await getWorkflowUsages(call, w.id)).toMatchObject({
        agents: [],
        agent_count: 0,
        agents_available: false,
      });
      const list = await listWorkflows(call, { limit: 50, offset: 0, attached: false });
      expect(list.items.map((x) => x.key)).toContain("ag");
    } finally {
      await owner.unsafe("grant select on hub.agent_workflows to admin_rw");
    }
  });
});
