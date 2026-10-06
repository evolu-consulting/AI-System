// HUB-FR-10 · ADM-FR-37 · HUB-H3b-AC-13 · Q-K11 · test-plan-cases H3b §2.10 A130–A134: command M5 qua quyền Admin trên code
// H2a (không code mới) — cấp feature cho group, kill switch, user không được cấp, thu hồi/cấp lại entitlement ≤ 5 s.
// Đỏ ⇒ TECH-DEBT, KHÔNG chặn mốc; ngoài `done:h3b` (G7). bunfig.toml/bunfig.int.toml bỏ `tests/acceptance/H3b-cmd/**` nên chạy
// bằng config không bỏ thư mục này: `bun --env-file=.env.local --config=bunfig.stack.toml test --timeout 30000
// ./tests/acceptance/H3b-cmd` (test-plan H3b §7, test-plan-log).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ErrorResponseSchema } from "@ai/contracts/chat";
import {
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  T,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import { type HubX, insertConv, insertHubConfig, send } from "../H1/_hub";
import {
  ARGS_DICH,
  catalogChange,
  type Dify,
  insertCatalog,
  MAP_DICH,
  menuNames,
  OUT,
  startDify,
  startHubH2a,
  WF,
} from "../H2a/_h2a";

const c = (n: number) => `a3bc0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const K = { feat: c(1), cmd: c(2), group: c(3) } as const;
const NAME = "ketoan";

let sql: Sql;
let k: Keys;
let hub: HubX;
let dify: Dify;

/** Feature `kt-tools` (on, entitlement acme, chưa grant) chứa lệnh `/ketoan` (workflow `dich`); group `ke-toan` = lan, hoa. */
async function insertCmdFixture(s: Sql): Promise<void> {
  await s`insert into admin.features (id, key, name, status) values
    (${K.feat}, 'kt-tools', ${s.json({ vi: "Kế toán", en: "Accounting" })}, 'on')`;
  await s`insert into admin.commands (id, name, aliases, description, workflow_id, args, input_map, output, mode,
      timeout_s, enabled) values
    (${K.cmd}, ${NAME}, ${s.array([])}, ${s.json({ vi: "Lệnh kế toán", en: null })}, ${WF.dich},
     ${s.json(ARGS_DICH as never)}, ${s.json(MAP_DICH as never)}, ${s.json(OUT)}, 'sync', 30, true)`;
  await s`insert into admin.command_names (name, command_id) values (${NAME}, ${K.cmd})`;
  await s`insert into admin.feature_commands (feature_id, command_id) values (${K.feat}, ${K.cmd})`;
  await s`insert into admin.feature_entitlements (feature_id, tenant_id) values (${K.feat}, ${T.acme})`;
  await s`insert into admin.groups (id, tenant_id, key, name) values (${K.group}, ${T.acme}, 'ke-toan', ${s.json({ vi: "Kế toán" })})`;
  await s`insert into admin.group_members (tenant_id, group_id, user_id) values
    (${T.acme}, ${K.group}, ${USERS.lan.id}), (${T.acme}, ${K.group}, ${USERS.hoa.id})`;
}

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  await insertCmdFixture(sql);
  k = await makeKeys();
  hub = await startHubH2a(k, { instanceId: "qc-hub-h3b-cmd" });
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  await sql?.end();
});

const menu = async (who: UserKey) => menuNames(hub, await sign(k, USERS[who]));
/** Chờ menu thoả `ok` (≤ 5 000 ms, poll 100 ms); trả menu + ms (in ra). */
async function menuUntil(who: UserKey, ok: (m: string[] | null) => boolean, tag: string) {
  const t0 = Date.now();
  const m = await waitFor(() => menu(who), ok, 5_000);
  console.log(`[${tag}] ${Date.now() - t0} ms`);
  return m;
}
const has = (m: string[] | null) => m?.includes(NAME) === true;
const hasNot = (m: string[] | null) => m !== null && !m.includes(NAME);
const grantCount = async () => {
  const [r] = await sql<
    { n: number }[]
  >`select count(*)::int as n from admin.feature_grants where feature_id = ${K.feat}`;
  return r?.n ?? -1;
};

describe("AC-13 · command M5 qua quyền Admin [HUB-FR-10 · ADM-FR-37 · HUB-H3b-AC-13 · Q-K11]", () => {
  it("HUB-FR-10 · A130 · cấp feature kt-tools cho group ke-toan ⇒ ≤ 5 s menu GET /commands của lan có /ketoan [HUB-H3b-AC-13]", async () => {
    expect(hasNot(await menu("lan"))).toBe(true);
    await catalogChange(
      sql,
      (tx) => tx`insert into admin.feature_grants (tenant_id, feature_id, group_id, user_id)
        values (${T.acme}, ${K.feat}, ${K.group}, null)`,
    );
    expect(await menuUntil("lan", has, "A130")).toContain(NAME);
  });

  it("HUB-FR-10 · A131 · kill switch feature (status off) ⇒ ≤ 5 s mất khỏi menu; bật lại ⇒ về [HUB-H3b-AC-13]", async () => {
    try {
      await catalogChange(
        sql,
        (tx) => tx`update admin.features set status = 'off' where id = ${K.feat}`,
      );
      expect(hasNot(await menuUntil("lan", hasNot, "A131 tắt"))).toBe(true);
    } finally {
      await catalogChange(
        sql,
        (tx) => tx`update admin.features set status = 'on' where id = ${K.feat}`,
      );
    }
    expect(await menuUntil("lan", has, "A131 bật")).toContain(NAME);
  });

  it("HUB-FR-10 · A132 · an (beta, không được cấp) gõ /ketoan ⇒ CMD_NOT_FOUND [HUB-H3b-AC-13]", async () => {
    const conv = await insertConv(sql, "an", c(100));
    const s = await send(hub, await sign(k, USERS.an), conv, `/${NAME} en xin chào`);
    s.close();
    expect(ErrorResponseSchema.safeParse(s.json).data?.error.code).toBe("CMD_NOT_FOUND");
  });

  it("HUB-FR-10 · A133 · thu hồi entitlement kt-tools/acme ⇒ ≤ 5 s mất; grant feature còn [HUB-H3b-AC-13]", async () => {
    await catalogChange(
      sql,
      (tx) => tx`update admin.feature_entitlements set revoked_at = now()
        where feature_id = ${K.feat} and tenant_id = ${T.acme}`,
    );
    expect(hasNot(await menuUntil("lan", hasNot, "A133"))).toBe(true);
    expect(await grantCount()).toBe(1);
  });

  it("HUB-FR-10 · A134 · cấp lại entitlement ⇒ ≤ 5 s hiệu lực lại, không cấp lại grant [HUB-H3b-AC-13]", async () => {
    await catalogChange(
      sql,
      (tx) => tx`update admin.feature_entitlements set revoked_at = null
        where feature_id = ${K.feat} and tenant_id = ${T.acme}`,
    );
    expect(await menuUntil("lan", has, "A134")).toContain(NAME);
    expect(await grantCount()).toBe(1);
  });
});
