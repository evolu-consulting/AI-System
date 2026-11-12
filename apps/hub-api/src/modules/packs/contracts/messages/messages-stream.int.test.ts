// CR-132 M4 · HD-MSG-01..12 · realtime tin nhắn: A gửi ⇒ `ustream:<B>` (Redis thật) có `msg.new` đúng contract; C (cùng công ty, ngoài hội thoại) không nhận gì;
// người nhận là mọi thành viên (cả A cho tab khác); thu hồi/đọc/đổi thành viên phát đúng khung. DB thật. KHÔNG sleep: `publish` được await trước khi use case
// trả về ⇒ đọc XRANGE ngay sau `await` là tín hiệu đủ (không chờ mốc giờ).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createRedis, type Redis } from "../../../../lib/redis";
import { userStreamKey } from "../../../../lib/user-stream";
import { parseFields } from "../../../me-stream/user-stream-reader";
import { internalUsersAmong } from "../../kit/adapters/member-names";
import { packStreamPublishMany } from "../../kit/adapters/pack-stream-publish";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackUow } from "../../kit/public";
import { messagesRepo } from "./adapters/messages.repo";
import type { MessagesRepos } from "./application/messages.ports";
import { messagesUsecases } from "./application/messages.usecase";

const REDIS_TEST_URL = process.env.HUB_TEST_REDIS_URL ?? "redis://localhost:6379/15";
let o: Sql;
let db: Db;
let redis: Redis;
let T = "";
let A = "";
let B = "";
let C = "";
let D = "";

const uc = () =>
  messagesUsecases({
    uow: createPackUow(db, "contracts", (tx, t) => ({
      messages: messagesRepo(tx, t),
    })) as never as PackUow<MessagesRepos>,
    people: internalUsersAmong(db),
    newId: () => Bun.randomUUIDv7(),
    publish: packStreamPublishMany(redis, { warn: () => undefined }),
  });
const w = (userId: string) => ({ tenantId: T, userId });
const got = async (uid: string) =>
  (await redis.xrange(userStreamKey(uid), "-", "+")).map(([, f]) => parseFields(f));
const clear = () => Promise.all([A, B, C, D].map((u) => redis.del(userStreamKey(u))));

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9401)) as [string];
  [A, B, C, D] = (await users(o, T, 4, { from: 9401 })) as [string, string, string, string];
  redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  await clear();
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
  redis?.disconnect();
});

describe("CR-132 M4 · msg.* qua ustream", () => {
  it("A gửi ⇒ B (thành viên) và A (tab khác) nhận msg.new; C (ngoài hội thoại) không nhận gì", async () => {
    const g = await uc().create(w(A), { kind: "group", title: "Mua hàng", member_ids: [B] });
    const cid = g.detail.id;
    expect((await got(B)).map((e) => e?.event)).toEqual(["msg.conversation"]); // B được thêm
    await clear();

    const req = { client_id: Bun.randomUUIDv7(), body: "Chào B", file_ids: [] };
    const sent = await uc().send(w(A), cid, req);
    for (const u of [B, A]) {
      const ev = await got(u);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ event: "msg.new", data: { conversation_id: cid } });
      const m = (ev[0] as { data: { message: { id: string; body: string } } }).data.message;
      expect(m).toMatchObject({ id: sent.message.id, body: "Chào B" });
    }
    expect(await got(C)).toEqual([]);
    expect(await got(D)).toEqual([]);

    await clear(); // gửi lặp cùng client_id ⇒ không phát lần nữa
    await uc().send(w(A), cid, req);
    expect(await got(B)).toEqual([]);
  });

  it("đọc ⇒ msg.read tới mọi thành viên (chỉ khi mốc tiến); thu hồi ⇒ msg.deleted; thêm/bớt người ⇒ msg.conversation đúng người", async () => {
    const g = await uc().create(w(A), { kind: "group", title: "Kho", member_ids: [B] });
    const cid = g.detail.id;
    const s = await uc().send(w(A), cid, {
      client_id: Bun.randomUUIDv7(),
      body: "x",
      file_ids: [],
    });
    await clear();

    await uc().markRead(w(B), cid, s.message.seq);
    expect((await got(A))[0]).toMatchObject({
      event: "msg.read",
      data: { user_id: B, seq: s.message.seq },
    });
    expect((await got(B)).map((e) => e?.event)).toEqual(["msg.read"]); // tab khác của B xoá chấm
    await clear();
    await uc().markRead(w(B), cid, s.message.seq); // không tiến ⇒ không phát
    expect(await got(A)).toEqual([]);

    await uc().revoke(w(A), cid, s.message.seq);
    expect((await got(B))[0]).toMatchObject({
      event: "msg.deleted",
      data: { conversation_id: cid, seq: s.message.seq },
    });
    expect(await got(C)).toEqual([]);
    await clear();

    await uc().addMembers(w(A), cid, [C]);
    expect((await got(C))[0]).toMatchObject({ data: { change: "added" } });
    expect((await got(B))[0]).toMatchObject({ data: { change: "updated" } });
    await clear();
    await uc().removeMember(w(A), cid, C);
    expect((await got(C))[0]).toMatchObject({ data: { change: "removed" } });
    expect((await got(A))[0]).toMatchObject({ data: { change: "updated" } });
    expect(await got(D)).toEqual([]);
  });
});
