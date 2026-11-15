// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-161 · dựng NitiGroup-test + Preschool-test trên stack journey (chạy sau `_ja-stack.ts`), rồi mở cổng "sẵn sàng" `CR161_READY_PORT`.
import { createDb } from "@ai/db";
import { apiLogin } from "../_kit/api";
import { configurePair, provisionPair } from "../_kit/two-companies.seed";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.cr161.config.ts)`);
  return v;
};

async function main(): Promise<void> {
  const [api, hub, pw] = [need("JA_API_URL"), need("JA_HUB_URL"), need("JA_USER_PW")];
  const admin = createDb(need("TEST_ADMIN_API_DATABASE_URL"), { max: 2 });
  await provisionPair(admin, admin, pw);
  const platform = await apiLogin({
    base: api,
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  await configurePair({ api, hub, pw, platform });
  Bun.serve({ port: Number(need("CR161_READY_PORT")), fetch: () => new Response("ok") });
  console.log("[cr161] hai công ty sẵn sàng");
}

await main();
