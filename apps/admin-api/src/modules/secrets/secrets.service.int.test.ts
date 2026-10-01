// ADM-FR-50, ADM-BR-04 · service secrets trên DB thật (role admin_api, RLS): bản mã giải mã được bằng khoá, log không rò.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { decryptSecret, parseMasterKey } from "../../lib/secret-crypto";
import {
  type Call,
  createSecret,
  deleteSecret,
  listSecrets,
  replaceSecret,
  updateSecretNote,
} from "./secrets.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const TID = "01900000-0000-7000-8000-00000000e001";
const UID = "01900000-0000-7000-8000-00000000e011";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 2 });
const key = parseMasterKey(randomBytes(32).toString("base64"));
const call: Call = {
  ctx: { db, secretKey: key },
  actor: { userId: UID, tenantId: TID, tenantKey: "platform", role: "platform_admin", sid: null },
  scope: { kind: "platform" },
};
const VALUE = "sk-SERVICE-LEAK-0123456789";

/** Lỗi bị ném (thay `expect(p).rejects`: treo với Bun 1.3.14 khi promise giữ transaction postgres-js). */
const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'platform', 'P')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${UID}, ${TID}, 'admin', 'h', 'A', 'platform_admin')`;
});
afterAll(async () => {
  await db.close();
  await owner.end();
});

const sealed = async (name: string) => {
  const [r] =
    await owner`select id, ciphertext, iv, key_version from admin.secrets where name = ${name}`;
  return {
    id: r?.id as string,
    s: { ciphertext: r?.ciphertext, iv: r?.iv, keyVersion: r?.key_version as number },
  };
};

describe("ADM-FR-50 · secrets.service", () => {
  test("ADM-FR-50 · tạo → PUT → PATCH → list → xoá; bản mã giải mã đúng; log không chứa giá trị", async () => {
    const log = spyOn(console, "log");
    const err = spyOn(console, "error");
    try {
      const s = await createSecret(call, { name: "SVC_KEY", value: VALUE, note: null });
      expect(s).toMatchObject({ name: "SVC_KEY", last4: "6789", updated_by: "admin", used_by: [] });
      let r = await sealed("SVC_KEY");
      expect(decryptSecret(key, r.id, r.s)).toBe(VALUE);
      await replaceSecret(call, "SVC_KEY", `${VALUE}-2`);
      r = await sealed("SVC_KEY");
      expect(decryptSecret(key, r.id, r.s)).toBe(`${VALUE}-2`);
      const n = await updateSecretNote(call, "SVC_KEY", { note: "ghi chú" });
      expect(n.note).toBe("ghi chú");
      const again = await sealed("SVC_KEY");
      expect(Buffer.from(again.s.iv).equals(Buffer.from(r.s.iv))).toBe(true);
      const list = await listSecrets(call, { limit: 50, offset: 0 });
      expect(list.counts).toEqual({ all: 1, used: 0, unused: 1 });
      await deleteSecret(call, "SVC_KEY");
      expect((await listSecrets(call, { limit: 50, offset: 0 })).total).toBe(0);
      const printed = [...log.mock.calls, ...err.mock.calls].flat().join("\n");
      expect(printed).not.toContain(VALUE);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });

  test("ADM-FR-50 · M2-R05 · đang dùng → SECRET_IN_USE; trùng tên → SECRET_NAME_TAKEN; tên lạ → NOT_FOUND", async () => {
    const s = await createSecret(call, { name: "USED_KEY", value: VALUE });
    await owner`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id)
      values (${Bun.randomUUIDv7()}, 'wf-a', 'W', ${"d".repeat(20)}, 'chat', 'https://x.test', ${s.id})`;
    // used_by/counts của list (subquery tương quan trong câu một bảng — lỗi `used_by: []` ở T6).
    const list = await listSecrets(call, { limit: 50, offset: 0 });
    expect(list.items.find((x) => x.name === "USED_KEY")?.used_by).toEqual(["wf-a"]);
    expect(list.counts.used).toBe(1);
    expect((await listSecrets(call, { limit: 50, offset: 0, used: true })).total).toBe(1);
    expect(await caught(deleteSecret(call, "USED_KEY"))).toMatchObject({
      code: "SECRET_IN_USE",
      details: { used_by: ["wf-a"] },
    });
    expect(await caught(createSecret(call, { name: "USED_KEY", value: VALUE }))).toMatchObject({
      code: "SECRET_NAME_TAKEN",
    });
    expect(await caught(deleteSecret(call, "NO_SUCH"))).toMatchObject({ code: "NOT_FOUND" });
  });

  test("ADM-NFR-01 · không có secretKey → lỗi thường (500), không ghi DB", async () => {
    const bare: Call = { ...call, ctx: { db } };
    expect(
      String((await caught(createSecret(bare, { name: "NOKEY", value: VALUE }))) ?? ""),
    ).toContain("secret key not configured");
    const [n] = await owner`select count(*)::int as n from admin.secrets where name = 'NOKEY'`;
    expect(n?.n).toBe(0);
  });
});
