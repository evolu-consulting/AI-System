// ADM-FR-55 · AC-A07 (phần API) · 409 VERSION_CONFLICT cho 6 thực thể có version: current + updated_at; updated_by có ở
// workflow/command/feature/group, vắng ở user/tenant (nền của câu R21); Ghi đè = gửi lại với version = current.version
// (M3-R18, R20, R21; test-plan I-C). Mỗi `it` tự dựng lại dữ liệu; không `it` nào đọc kết quả của `it` khác.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  CommandSchema,
  FeatureDetailSchema,
  GroupSchema,
  UserSchema,
  WorkflowSchema,
} from "@ai/contracts";
import {
  callerOf,
  createM3Env,
  expectErr,
  ID,
  ID3,
  type M3Env,
  newField,
  num,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";

let env: M3Env;
let admin: ReturnType<typeof callerOf>;

beforeAll(async () => {
  env = await createM3Env();
  admin = callerOf(env, "platform", "admin");
});
beforeEach(async () => {
  await env.reset3();
});
afterAll(async () => {
  await env.close();
});

type Entity = {
  name: string;
  path: string;
  parse: (j: unknown) => { version: number };
  a: Record<string, unknown>;
  b: Record<string, unknown>;
  read: (j: unknown) => unknown;
  /** user/tenant không có updated_by (câu R21 không `{user}`). */
  hasUpdatedBy: boolean;
  startVersion?: { table: string; id: string; version: number };
};
const nested = (j: unknown, ...path: string[]) =>
  path.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], j);
const ENTITIES: Entity[] = [
  {
    name: "user",
    path: `/admin/users/${USER_ID.lan}`,
    parse: (j) => UserSchema.parse(j),
    a: { display_name: "Lan A" },
    b: { display_name: "Lan B" },
    read: (j) => newField(j, "display_name"),
    hasUpdatedBy: false,
  },
  {
    name: "tenant",
    path: `/admin/tenants/${TENANT_ID.acme}`,
    // GET trả TenantDetail (có stats), PATCH/current trả Tenant → chỉ đọc version
    parse: (j) => ({ version: newField<number>(j, "version") }),
    a: { name: "Acme A" },
    b: { name: "Acme B" },
    read: (j) => newField(j, "name"),
    hasUpdatedBy: false,
  },
  {
    name: "workflow",
    path: `/admin/workflows/${ID.workflow.translate}`,
    parse: (j) => WorkflowSchema.parse(j),
    a: { name: "Translate A" },
    b: { name: "Translate B" },
    read: (j) => newField(j, "name"),
    hasUpdatedBy: true,
  },
  {
    name: "command",
    path: `/admin/commands/${ID.command.dich}`,
    parse: (j) => CommandSchema.parse(j),
    a: { description: { vi: "Mô tả A" } },
    b: { description: { vi: "Mô tả B" } },
    read: (j) => nested(j, "description", "vi"),
    hasUpdatedBy: true,
    startVersion: { table: "commands", id: ID.command.dich, version: 7 },
  },
  {
    name: "feature",
    path: `/admin/features/${ID.feature.keToan}`,
    parse: (j) => FeatureDetailSchema.parse(j),
    a: { name: { vi: "Kế toán A" } },
    b: { name: { vi: "Kế toán B" } },
    read: (j) => nested(j, "name", "vi"),
    hasUpdatedBy: true,
  },
  {
    name: "group",
    path: `/admin/groups/${ID3.group.acmeKeToan}`,
    parse: (j) => GroupSchema.parse(j),
    a: { name: { vi: "KT A" } },
    b: { name: { vi: "KT B" } },
    read: (j) => nested(j, "name", "vi"),
    hasUpdatedBy: true,
  },
];

async function startAt(e: Entity): Promise<number> {
  if (e.startVersion) {
    const s = e.startVersion;
    await env.owner.unsafe(
      `update admin.${s.table} set version = ${s.version} where id = '${s.id}'`,
    );
    return s.version;
  }
  return e.parse((await admin("GET", e.path)).json).version;
}

describe("ADM-FR-55 · 409 VERSION_CONFLICT kèm current + updated_at (M3-R18, R20)", () => {
  for (const e of ENTITIES) {
    it(`ADM-FR-55 · AC-A07 · ${e.name}: A lưu (v→v+1), B lưu với version cũ → 409; details.current là bản của A (version, updated_at ISO); DB giữ bản của A`, async () => {
      const v = await startAt(e);
      const first = await admin("PATCH", e.path, { version: v, ...e.a });
      expect(first.status).toBe(200);
      expect(e.parse(first.json).version).toBe(v + 1);
      const res = await admin("PATCH", e.path, { version: v, ...e.b });
      expectErr(res, "VERSION_CONFLICT");
      const d = res.json.error.details as { current: Record<string, unknown>; updated_at: string };
      expect(typeof d.updated_at).toBe("string");
      expect(Number.isNaN(Date.parse(d.updated_at))).toBe(false);
      const current = e.parse(d.current);
      expect(current.version).toBe(v + 1);
      expect(e.read(d.current)).toEqual(e.read(first.json));
      expect(e.read((await admin("GET", e.path)).json)).toEqual(e.read(first.json));
      const by = newField<unknown>(d.current, "updated_by");
      if (e.hasUpdatedBy) expect(by).toBe("admin");
      else expect(by === undefined || by === null).toBe(true);
    });

    it(`ADM-FR-55 · AC-A07 · ${e.name}: Ghi đè = gửi lại cùng body với version = current.version → 200, version = current + 1, dữ liệu là của người gửi`, async () => {
      const v = await startAt(e);
      await admin("PATCH", e.path, { version: v, ...e.a });
      const conflict = await admin("PATCH", e.path, { version: v, ...e.b });
      expectErr(conflict, "VERSION_CONFLICT");
      const cur = conflict.json.error.details.current as { version: number };
      const over = await admin("PATCH", e.path, { version: cur.version, ...e.b });
      expect(over.status).toBe(200);
      expect(e.parse(over.json).version).toBe(cur.version + 1);
      expect(e.read(over.json)).toEqual(e.read(e.b));
    });
  }

  it("ADM-FR-55 · AC-A07 · /dich version 7: B lưu → 8; A lưu với 7 → 409 current.version = 8; Ghi đè → 9", async () => {
    const e = ENTITIES.find((x) => x.name === "command") as Entity;
    await startAt(e);
    expect(
      await num(
        env.owner,
        `select version::int as n from admin.commands where id = '${ID.command.dich}'`,
      ),
    ).toBe(7);
    const b = await admin("PATCH", e.path, { version: 7, ...e.b });
    expect(CommandSchema.parse(b.json).version).toBe(8);
    const a = await admin("PATCH", e.path, { version: 7, ...e.a });
    expectErr(a, "VERSION_CONFLICT");
    expect(a.json.error.details.current.version).toBe(8);
    const over = await admin("PATCH", e.path, { version: 8, ...e.a });
    expect(CommandSchema.parse(over.json).version).toBe(9);
    expect(nested(over.json, "description", "vi")).toBe("Mô tả A");
  });
});
