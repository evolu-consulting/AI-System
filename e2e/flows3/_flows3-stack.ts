// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-165 · dựng 3 công ty (Niti / Evolu / Preschool-flows) trên stack journey (chạy sau `_ja-stack.ts`): người + phòng theo yaml, hồ sơ + Danh bạ + tính năng gửi/nhận
// với đối tác, rồi ÁP ĐÚNG bộ quy trình thật (`flowsFor` — cùng đường `bun run tenant:flows`) và dòng đối tác trong sổ của bên gửi. Xong ⇒ mở cổng "sẵn sàng".
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@ai/db";
import { setJourneyPasswords } from "../../tools/scripts/src/seed-e2e-journey";
import { runSeed } from "../../tools/scripts/src/seed-niti";
import { applyTenantFlows, type Call, type Json } from "../../tools/scripts/src/tenant-flows.core";
import { flowsFor } from "../../tools/scripts/src/tenant-flows.data";
import { readOrg } from "../../tools/scripts/src/tenant-flows.org";
import {
  apiLogin,
  featureIdByKey,
  grantFeature,
  setCompanyProfile,
  setDirectoryListed,
  tenantIdByKey,
} from "../_kit/api";
import { enableFlowTriggers } from "../_kit/flows";
import { seedPartner } from "../journey-approval/_partner-pick";
import { CO, seedPeople, userOf, WHO } from "./_flows3-org";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.flows3.config.ts)`);
  return v;
};
const SIDES = ["n", "e", "p"] as const;

const caller =
  (base: string, token: string): Call =>
  async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
  };

async function main(): Promise<void> {
  const [api, hubUrl, pw] = [need("JA_API_URL"), need("JA_HUB_URL"), need("JA_USER_PW")];
  const admin = createDb(need("TEST_ADMIN_API_DATABASE_URL"), { max: 2 });
  for (const side of SIDES) {
    const { root, depts, people } = seedPeople(side);
    const key = CO[side].key();
    const credFile = join(tmpdir(), `e2e-flows3-cred-${process.pid}-${side}.txt`);
    const dept = (k: string) => ({ key: k, vi: k, en: k });
    try {
      await runSeed(
        admin,
        admin,
        {
          tenantKey: key,
          tenantName: `E2E ${CO[side].name}`,
          timezone: "Asia/Ho_Chi_Minh",
          emailDomain: `${key}.example.invalid`,
          packs: ["contracts"],
          root: dept(root),
          departments: depts.map(dept),
          people,
        },
        { apply: true, credFile },
      );
      await setJourneyPasswords(admin, key, pw);
    } finally {
      rmSync(credFile, { force: true });
    }
  }
  const platform = await apiLogin({
    base: api,
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  const feats = [
    await featureIdByKey(api, platform, "contracts-partner-confirm"),
    await featureIdByKey(api, platform, "contracts-community"),
  ];
  const adm = caller(api, platform.token);
  const hub = caller(hubUrl, platform.token);
  for (const side of SIDES) {
    const key = CO[side].key();
    const id = await tenantIdByKey(api, platform, key);
    await setCompanyProfile(api, platform, id, {
      legal_name: CO[side].name,
      tax_code: CO[side].tax,
      address: `${side} Phố Quy Trình, Hà Nội`,
    });
    for (const f of feats) await grantFeature(api, platform, f, id);
    const boss = await apiLogin({
      base: api,
      tenantKey: key,
      username: WHO[side].giamdoc,
      password: pw,
      app: "contracts",
    });
    await setDirectoryListed(api, boss, id, true);
    await enableFlowTriggers(key);
    // quy trình: người = email THẬT ở yaml → tài khoản fixture cùng tên
    const g = (await adm("GET", `/admin/groups?tenant_id=${id}&limit=200`)).json.items as Json[];
    const u = (await adm("GET", `/admin/users?tenant_id=${id}&limit=200`)).json.items as Json[];
    const byUser = new Map(u.map((x) => [String(x.username), String(x.id)]));
    const uid = (email: string): string =>
      byUser.get(userOf(email)) ??
      ((): never => {
        throw new Error(`thiếu người ${email} ở ${key}`);
      })();
    const rep = await applyTenantFlows(
      { hub, tid: id, groups: new Map(g.map((x) => [String(x.key), String(x.id)])) },
      flowsFor(CO[side].yaml, uid, readOrg(CO[side].yaml)),
      { dryRun: false },
    );
    for (const r of rep) console.log(`[flows3] ${key}: «${r.name}» ${r.action}`);
  }
  // Sổ đối tác của bên gửi (danh sách chọn ở bước «Chọn đối tác»): N → Evolu, Preschool → N (người thêm ≠ người chọn nếu có thể)
  await seedPartner(CO.n.key(), CO.e.tax, CO.e.name, WHO.n.ktNv);
  await seedPartner(CO.p.key(), CO.n.tax, CO.n.name, WHO.p.giamdoc);
  Bun.serve({ port: Number(need("FLOWS3_READY_PORT")), fetch: () => new Response("ok") });
  console.log("[flows3] 3 công ty sẵn sàng");
}

await main();
