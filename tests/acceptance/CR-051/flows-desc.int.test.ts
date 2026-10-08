// HUB-FR-45 · CR-051: E10 `order=desc` — trang đầu là flow mới nhất, `next_cursor` đi về trang cũ hơn (Chat tải 30 flow mới
// nhất rồi cuộn lên mới tải tiếp); vắng `order` giữ nguyên `asc`; `order` lạ ⇒ 400.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ChatPageSchema, FlowSchema } from "@ai/contracts/chat";
import {
  call,
  type Hub,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  R,
  type Sql,
  sign,
  startHub,
  USERS,
} from "../H1/_fixtures";

let sql: Sql;
let k: Keys;
let hub: Hub;
let lan: string;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  k = await makeKeys();
  hub = await startHub(k);
  lan = await sign(k, USERS.lan);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

const page = async (q: string) => {
  const r = await call(hub, "GET", `/conversations/${R.conv}/flows${q}`, { token: lan });
  expect(r.status).toBe(200);
  return ChatPageSchema(FlowSchema).parse(r.json);
};

describe("CR-051 · E10 order=desc", () => {
  it("HUB-FR-45 · CR-051 · desc limit 1: flow2 → (cursor) flow → hết; asc vắng order như cũ", async () => {
    const p1 = await page("?order=desc&limit=1");
    expect(p1.items.map((f) => f.id)).toEqual([R.flow2]);
    expect(p1.next_cursor).not.toBeNull();
    const p2 = await page(`?order=desc&limit=1&cursor=${p1.next_cursor}`);
    expect(p2.items.map((f) => f.id)).toEqual([R.flow]);
    expect(p2.next_cursor).toBeNull();
    expect((await page("")).items.map((f) => f.id)).toEqual([R.flow, R.flow2]);
  });

  it("HUB-FR-45 · CR-051 · order lạ ⇒ 400", async () => {
    const r = await call(hub, "GET", `/conversations/${R.conv}/flows?order=sideways`, {
      token: lan,
    });
    expect(r.status).toBe(400);
  });
});
