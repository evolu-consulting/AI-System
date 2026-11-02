// `bun --env-file=.env.local tools/hub-dev/src/demo-packs.ts [--tenant demo]`: bật Sổ Hợp Tác + Community và đưa user vào Group
// của gói (idempotent). Mặc định tenant `evolu` (user demo của hub:dev); `--tenant demo` ⇒ `demo-owner` làm chủ gói (tenant do
// `seed-community-demo --dev-fixture` tạo). `scripts/dev-up.ps1` gọi sau khi admin-api lên; không đổi hành vi `hub:dev`.
// seed-refresh: xong thì chạy `seed.tenant-fixtures` (SQL, cổng HUB_SEED_FIXTURES=1 + APP_ENV≠production): owner/editor gói,
// feature engine, nhóm Kế toán, thương hiệu, URL catalog — bảo đảm cả khi bước HTTP ở trên bỏ sót Group.
import { parseArgs } from "node:util";
import { runTenantFixtures } from "../../../apps/hub-api/src/modules/seed/seed.tenant-fixtures";
import { AUTH_URL } from "./dev";
import { DEMO_PACKS, ensureDemoPacks, ensureTenantPacks } from "./fixture";

const { values } = parseArgs({
  options: { tenant: { type: "string" }, admin: { type: "string" } },
});
const adminUrl = values.admin || AUTH_URL;
if (values.tenant === "demo")
  await ensureTenantPacks(adminUrl, { tenantKey: "demo", owners: ["demo-owner"], editors: [] });
else if (!values.tenant || values.tenant === "evolu") await ensureDemoPacks(adminUrl);
else throw new Error(`demo-packs: chỉ hỗ trợ tenant evolu | demo (nhận ${values.tenant})`);
console.log(`đã bật gói ${DEMO_PACKS.join(", ")} cho tenant ${values.tenant ?? "evolu"}`);
const fx = await runTenantFixtures(process.env);
console.log(
  fx ? `fixture công ty: ${JSON.stringify(fx)}` : "fixture công ty: bỏ qua (HUB_SEED_FIXTURES≠1)",
);
