// sohoptac2-stg · seed staging (chạy trong container `tool` của project sohoptac2-stg, mount tại /app/tools/scripts/src/stg-seed.ts):
// tenant `demo` + demo-owner (mật khẩu từ file DEMO_OWNER.pw, KHÔNG in) + bật gói contracts + cộng đồng đối tác (seed-community-demo:
// 3 công ty, bài + luồng mẫu). Gọi thẳng hàm thư viện (CLI seed từ chối host DB `pg`). TỪ CHỐI khi APP_ENV=production hoặc thiếu STG marker.
// Mật khẩu tạm của đối tác ghi vào STG_PW_OUT (600).
import { readFileSync } from "node:fs";
import { createDb, withScope } from "@ai/db";
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
if (!/^http:\/\/127\.0\.0\.1:284\d\d$/.test(need("S2_PUBLIC_ADMIN_URL")))
  throw new Error("stg-seed: từ chối — không phải .env của sohoptac2-stg (S2_PUBLIC_ADMIN_URL)");

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
  console.log(`[stg-seed] demo-owner ∈ community-owner: ${await ensureOwnerInGroup(db)}`);
} finally {
  await hubDb.close();
  await db.close();
}
