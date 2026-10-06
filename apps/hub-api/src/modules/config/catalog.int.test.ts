// HUB-FR-76, HUB-FR-95 · HUB-H2a-AC-10 · HUB-BR-06 · H2a P5 · X1 plan §2.3 · cache catalog thật (role hub_api) trên dữ liệu cases §7:
// `usableCatalogCommands` của lan/hoa/tadmin/an = `visible` của `computeEffectiveAccess` Admin đọc từ CÙNG SQL
// (`adminVisible`, tests H2a, chỉ đọc), qua các biến thể A08; đổi catalog → NOTIFY → cache mới ≤ 5 s; nguồn side_effect.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  USERS,
  type UserKey,
  waitFor,
} from "../../../../../tests/acceptance/H1/_fixtures";
import {
  adminVisible,
  CMD,
  catalogChange,
  FEAT,
  insertCatalog,
  markSideEffect,
  WF,
} from "../../../../../tests/acceptance/H2a/_h2a";
import { connectDb, type Db } from "../../lib/db";
import { logger } from "../../lib/logger";
import { usableCatalogCommands } from "./catalog.rules";
import { type ConfigCache, startConfigCache } from "./config.service";

let sql: Sql;
let db: Db;
let cache: ConfigCache;
const ac = new AbortController();
const WHO: UserKey[] = ["lan", "hoa", "tadmin", "an"];

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertCatalog(sql, { baseUrl: "http://dify.invalid/v1" });
  db = connectDb(HUB_API_URL, 3);
  cache = startConfigCache(db, { pollS: 3600, log: logger, signal: ac.signal });
}, 60_000);
afterAll(async () => {
  ac.abort();
  await db?.close();
  await sql?.end();
});

async function hubNames(who: UserKey): Promise<string[]> {
  const u = USERS[who];
  const user = await cache.user(u.id);
  if (!user) return [];
  const cat = await cache.catalog();
  return usableCatalogCommands(cat, await cache.tenant(u.tid), user).map((x) => x.command.name);
}

const VARIANTS: {
  name: string;
  apply: (tx: Sql) => Promise<unknown>;
  undo: (tx: Sql) => Promise<unknown>;
}[] = [
  { name: "gốc", apply: async () => {}, undo: async () => {} },
  {
    name: "labs on",
    apply: (tx) => tx`update admin.features set status = 'on' where id = ${FEAT.labs}`,
    undo: (tx) => tx`update admin.features set status = 'beta' where id = ${FEAT.labs}`,
  },
  {
    name: "thu hồi entitlement translate acme",
    apply: (tx) => tx`update admin.feature_entitlements set revoked_at = now()
      where feature_id = ${FEAT.translate} and tenant_id = ${USERS.lan.tid}`,
    undo: (tx) => tx`update admin.feature_entitlements set revoked_at = null
      where feature_id = ${FEAT.translate} and tenant_id = ${USERS.lan.tid}`,
  },
  {
    name: "workflow dich tắt",
    apply: (tx) => tx`update admin.workflows set enabled = false where id = ${WF.dich}`,
    undo: (tx) => tx`update admin.workflows set enabled = true where id = ${WF.dich}`,
  },
  {
    name: "command dich tắt",
    apply: (tx) => tx`update admin.commands set enabled = false where id = ${CMD.dich}`,
    undo: (tx) => tx`update admin.commands set enabled = true where id = ${CMD.dich}`,
  },
];

describe("HUB-H2a-AC-10 · cache catalog Hub = Admin trên cùng SQL", () => {
  it.each(VARIANTS.map((v) => [v.name, v] as const))(
    "HUB-FR-76 · HUB-H2a-AC-10 · biến thể %s: lan, hoa, tadmin, an khớp Admin (NOTIFY ≤ 5 s)",
    async (_n, v) => {
      try {
        await catalogChange(sql, (tx) => v.apply(tx as unknown as Sql));
        for (const who of WHO) {
          const want = await adminVisible(sql, who);
          const got = await waitFor(
            () => hubNames(who),
            (m) => JSON.stringify(m) === JSON.stringify(want),
            5_000,
          );
          expect({ who, got }).toEqual({ who, got: want });
        }
      } finally {
        await catalogChange(sql, (tx) => v.undo(tx as unknown as Sql));
      }
    },
  );

  it("HUB-FR-76 · gốc cases §7: lan {dich, hoi, so}, tadmin {hoi}", async () => {
    await cache.reloadAdmin();
    expect(await hubNames("lan")).toEqual(["dich", "hoi", "so"]);
    expect(await hubNames("tadmin")).toEqual(["hoi"]);
  });
});

describe("X1 · nguồn side_effect = cột admin.workflows.side_effect", () => {
  it("HUB-FR-95 · đổi cột + reloadAdmin ⇒ cờ đổi; hub.workflow_flags không còn tác dụng", async () => {
    await cache.reloadAdmin();
    let cat = await cache.catalog();
    expect(cat.workflows.get(WF.trello)?.sideEffect).toBe(true);
    await sql`insert into hub.workflow_flags (workflow_id, side_effect) values (${WF.trello}, true)
      on conflict (workflow_id) do update set side_effect = excluded.side_effect`;
    await markSideEffect(sql, WF.trello, false);
    try {
      await cache.reloadAdmin();
      cat = await cache.catalog();
      expect(cat.workflows.get(WF.trello)?.sideEffect).toBe(false);
    } finally {
      await sql`delete from hub.workflow_flags where workflow_id = ${WF.trello}`;
      await markSideEffect(sql, WF.trello, true);
      await cache.reloadAdmin();
    }
  });
});
