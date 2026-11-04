// CR-118 · cr118-files-quota · `POST /pack/community/files` có trần lượt tải (review TB): tenant/ngày (bộ đếm Redis riêng
// `q:community:`, dùng lại luật quota contracts) + người/phút ⇒ 429 `UPLOAD_QUOTA` {scope}; tải hỏng sau khi giữ lượt ⇒ hoàn;
// tenant khác không bị ảnh hưởng. Redis + DB thật. Ngày giả ngẫu nhiên (năm 2100+) ⇒ khoá không đụng lượt chạy khác.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../tests/acceptance/com-c3/_support/cast";
import { REDIS_TEST_URL } from "../../../../../tests/acceptance/H1/_fixtures";
import { mapError } from "../../lib/errors";
import { createRedis, type Redis } from "../../lib/redis";
import type { CommunityBlobs } from "./community/application/pack-ports";
import { communityModule } from "./community/community.mount";
import { communityUploadGate } from "./community-quota.mount";
import { pgExternalOrgResolver } from "./kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "./kit/adapters/pack-guard.middleware";

let sql: Sql;
let db: Db;
let redis: Redis;
let c: Cast;
const F = ["c-r", "c-w", "c-a"];
const KEYS = ["community-read", "community-write", "community-admin"];

const view = (): PackAccessView => ({
  catalog: async () => ({
    features: F.map((id, i) => ({ id, key: KEYS[i] as string, status: "on" as const })),
    entitled: new Set(F.flatMap((f) => [`${c.A}:${f}`, `${c.B}:${f}`])),
    grantGroups: new Map(
      F.flatMap((f) => [
        [`${c.A}:${f}`, [c.roles.owner, c.roles.editor]],
        [`${c.B}:${f}`, ["gB"]],
      ]),
    ),
  }),
  user: async (id) =>
    id === c.hB
      ? { tenantId: c.B, groupIds: new Set(["gB"]) }
      : {
          tenantId: c.A,
          groupIds: new Set(id === c.hA ? [c.roles.owner] : id === c.hM ? [c.roles.editor] : []),
        },
});

const blobs: CommunityBlobs = {
  put: async () => ({ fileId: crypto.randomUUID(), versionId: null }),
  get: async () => null,
  drop: async () => {},
};

/** Ngày ngẫu nhiên ở xa ⇒ khoá ngày riêng cho mỗi app (cùng tenant id tất định của cast). */
const farDay = () =>
  new Date(Date.UTC(2100, 0, 1) + Math.floor(Math.random() * 30_000) * 86_400_000);

type Who = "hA" | "hM" | "hB";
function build(limits: { tenant: number; global: number; userPerMinute: number }) {
  const at = farDay();
  const gate = communityUploadGate({ redis, timeZoneOf: async () => "UTC", limits, now: () => at });
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    ctx.set("user", {
      userId: c[who],
      tenantId: who === "hB" ? c.B : c.A,
      role: who === "hA" ? "tenant_admin" : "member",
      userKind: "internal",
    } as never);
    await next();
  });
  h.route("/", communityModule(db, view(), pgExternalOrgResolver(db), { blobs, gate }));
  h.onError((e, ctx) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return ctx.json(m.body, m.status);
  });
  return h;
}

const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
const up = async (app: Hono<PackGuardVars>, who: Who, bytes = PDF, name = "a.pdf") => {
  const res = await app.request("/files", {
    method: "POST",
    headers: { "x-who": who, "x-filename": name },
    body: bytes,
  });
  // biome-ignore lint/suspicious/noExplicitAny: JSON tự do trong test
  return { status: res.status, json: (await res.json()) as any };
};

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 73);
  db = createDb(urls().hubApi, { max: 2 });
  redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
}, 120_000);
afterAll(async () => {
  redis?.disconnect();
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("POST /files — trần lượt tải (cr118-files-quota)", () => {
  it("[CR-118] tenant hết lượt ngày ⇒ 429 UPLOAD_QUOTA scope tenant; tải hỏng được hoàn; tenant khác vẫn tải", async () => {
    const app = build({ tenant: 2, global: 1000, userPerMinute: 100 });
    expect((await up(app, "hA", EXE)).status).toBe(415); // giữ rồi hoàn ⇒ không tính
    expect((await up(app, "hA")).status).toBe(201);
    expect((await up(app, "hM")).status).toBe(201);
    const hit = await up(app, "hA");
    expect(hit.status).toBe(429);
    expect(hit.json.error.code).toBe("UPLOAD_QUOTA");
    expect(hit.json.error.details).toMatchObject({ scope: "tenant", limit: 2 });
    expect(typeof hit.json.error.details.resets_at).toBe("string");
    expect((await up(app, "hB")).status).toBe(201);
    expect((await up(app, "hB")).status).toBe(201);
  });

  it("[CR-118] người dùng vượt lượt/phút ⇒ 429 scope user; người khác cùng tenant không bị chặn", async () => {
    const app = build({ tenant: 100, global: 1000, userPerMinute: 1 });
    expect((await up(app, "hM")).status).toBe(201);
    const hit = await up(app, "hM");
    expect(hit.status).toBe(429);
    expect(hit.json.error).toMatchObject({
      code: "UPLOAD_QUOTA",
      details: { scope: "user", limit: 1 },
    });
    expect((await up(app, "hA")).status).toBe(201);
  });
});
