// sohoptac2-staging · seed staging -test (ban cua stg-sohoptac2/stg-seed.ts; chay trong container `tool` cua project sohoptac2-staging, mount tai /app/tools/scripts/src/stg-seed.ts):
// tenant `demo` + demo-owner (mat khau tu file DEMO_OWNER.pw, KHONG in) + bat goi contracts + cong dong doi tac (seed-community-demo:
// 3 cong ty, bai + luong mau). Goi thang ham thu vien (CLI seed tu choi host DB `pg`). TU CHOI khi APP_ENV=production hoac .env khong phai cua stg-test.
// Mat khau tam cua doi tac ghi vao STG_PW_OUT (600).
import { readFileSync } from "node:fs";
import { createDb, hashPassword, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { enablePack } from "../../../apps/admin-api/src/modules/packs/packs.service";
import { runSeed } from "./seed-community-demo";
import {
  DEMO_OWNER,
  ensureDemoTenant,
  ensureOwnerInGroup,
} from "./seed-community-demo.dev-fixture";
import { grantGroup } from "./seed-community-demo.grant";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`stg-seed: thiếu ${n}`);
  return v;
};

if (process.env.APP_ENV === "production") throw new Error("stg-seed: từ chối — APP_ENV=production");
if (
  need("S2_STACK") !== "stg-test" ||
  !/^https:\/\/ai-test-admin\.[a-z0-9.-]+$/.test(need("S2_PUBLIC_ADMIN_URL"))
)
  throw new Error(
    "stg-seed: từ chối — không phải .env của sohoptac2-staging (S2_STACK / S2_PUBLIC_ADMIN_URL)",
  );

const ownerPw = readFileSync(need("DEMO_OWNER_PW_FILE"), "utf8").trim();
const db = createDb(need("DATABASE_URL"), { max: 2 });
const hubDb = createDb(need("HUB_DATABASE_URL"), { max: 2 });
try {
  const t = await ensureDemoTenant(db, ownerPw);
  console.log(`[stg-seed] tenant demo ${t.tenant}, demo-owner ${t.owner}`);
  const [r] = await withScope(
    db,
    { kind: "platform" },
    async (tx) =>
      (await tx.execute(sql`select t.id as tid, u.id as uid from admin.tenants t
        join admin.users u on u.tenant_id = t.id and u.username = ${DEMO_OWNER.username}
        where t.key = 'demo'`)) as unknown as { tid: string; uid: string }[],
  );
  if (!r) throw new Error("stg-seed: không thấy demo/demo-owner");
  // Nhân viên (demo-editor) + kế toán (demo-viewer): PURCHASE_ROLE_GROUPS / seed.tenant-fixtures xếp họ vào nhóm duyệt; vắng ⇒ nhóm kế toán rỗng.
  // Idempotent, không đổi user đã có; dùng chung mật khẩu DEMO_OWNER.pw (staging).
  const hash = await hashPassword(ownerPw);
  for (const [username, displayName] of [
    ["demo-editor", "Lê Văn Cường – Nhân viên"],
    ["demo-viewer", "Trần Thị Bình – Kế toán"],
  ] as const)
    await withScope(db, { kind: "platform" }, (tx) =>
      tx.execute(sql`insert into admin.users
          (id, tenant_id, username, password_hash, display_name, email, role, locale, must_change_password)
          values (${Bun.randomUUIDv7()}, ${r.tid}, ${username}, ${hash}, ${displayName},
                  ${`${username}@example.invalid`}, 'member', 'vi', false)
          on conflict (tenant_id, username) do nothing`),
    );
  const call = { ctx: { db }, scope: { kind: "platform" } as const, actor: { userId: r.uid } };
  await enablePack(call, r.tid, "contracts"); // idempotent: khoá feature, entitlement, Group contracts-owner/editor/viewer
  console.log(
    `[stg-seed] contracts-owner += demo-owner: ${(await grantGroup(db, "demo", "contracts-owner", [DEMO_OWNER.username])).join(",") || "(đã có)"}`,
  );
  await runSeed(db, {
    tenantKey: "demo",
    apply: true,
    forceTenant: false,
    out: need("STG_PW_OUT"),
    hubDb,
  });
  console.log(`[stg-seed] demo-owner ∈ contracts-owner: ${await ensureOwnerInGroup(db)}`);
} finally {
  await hubDb.close();
  await db.close();
}
