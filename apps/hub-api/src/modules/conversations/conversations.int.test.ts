// HUB-FR-40 · HUB-FR-45 · HUB-BR-14 · E5–E11 trên hub-api thật + DB (dùng hạ tầng QW-A1 `tests/acceptance/H1/_fixtures`,
// chỉ đọc). Bổ sung phần A5 không cần E12–E15: tài nguyên của `lan` × người khác ≡ uuid lạ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ChatPageSchema, ConversationSchema, FlowSchema, MessageSchema } from "@ai/contracts/chat";
import {
  call,
  err,
  errorOf,
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
  UNKNOWN,
  USERS,
  type UserKey,
} from "../../../../../tests/acceptance/H1/_fixtures";

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

const eps = (conv: string, flow: string) =>
  [
    ["GET", `/conversations/${conv}`, undefined],
    ["PATCH", `/conversations/${conv}`, { title: "Đổi" }],
    ["PATCH", `/conversations/${conv}`, { title: "Đổi", bad: 1 }],
    ["GET", `/conversations/${conv}/flows`, undefined],
    ["GET", `/conversations/${conv}/flows?limit=0`, undefined],
    ["GET", `/conversations/${conv}/messages`, undefined],
    ["GET", `/conversations/${conv}/messages?flow_id=${flow}`, undefined],
    ["DELETE", `/conversations/${conv}`, undefined],
  ] as const;

describe("E7–E11 · cách ly: tài nguyên người khác ≡ uuid lạ (404) [HUB-BR-14 · H1-R03]", () => {
  for (const who of ["hoa", "an", "tadmin", "padmin"] as UserKey[]) {
    it(`HUB-H1-AC-H07 · ${who} × E7–E11 của lan → 404 giống hệt uuid lạ, dữ liệu nguyên`, async () => {
      const token = await sign(k, USERS[who]);
      const mine = eps(R.conv, R.flow);
      const ref = eps(UNKNOWN, UNKNOWN);
      for (const [i, [m, p, body]] of mine.entries()) {
        const [rm, rp, rb] = ref[i] as (typeof ref)[number];
        const want = await call(hub, rm, rp, { token, body: rb });
        const got = await call(hub, m, p, { token, body });
        expect({ p, ...errorOf(got), json: got.json }).toEqual({
          p,
          ...err("NOT_FOUND"),
          json: want.json,
        });
      }
      const [c] = await sql`select title, deleted_at from hub.conversations where id = ${R.conv}`;
      expect(c).toEqual({ title: "Hoá đơn tháng 9", deleted_at: null });
    });
  }
});

describe("E5–E11 · chủ hội thoại [HUB-FR-40 · HUB-FR-45]", () => {
  it("HUB-FR-40 · E5 q không dấu + bỏ tenant_id/user_id trong query; cursor rác → 400", async () => {
    for (const q of ["hoa don", "HOÁ ĐƠN", "đơn"]) {
      const res = await call(
        hub,
        "GET",
        `/conversations?q=${encodeURIComponent(q)}&tenant_id=${USERS.an.tid}`,
        { token: lan },
      );
      const page = ChatPageSchema(ConversationSchema).parse(res.json);
      expect(page.items.map((x) => x.id)).toEqual([R.conv]);
    }
    const none = await call(hub, "GET", "/conversations?q=%25", { token: lan });
    expect(none.json.items).toEqual([]);
    expect(errorOf(await call(hub, "GET", "/conversations?cursor=abc", { token: lan }))).toEqual(
      err("VALIDATION_ERROR"),
    );
    expect(errorOf(await call(hub, "GET", "/conversations?x=1", { token: lan }))).toEqual(
      err("VALIDATION_ERROR"),
    );
  });

  it("HUB-FR-40 · E6 + E5 limit=1 theo next_cursor: updated_at giảm, không lặp", async () => {
    for (const t of ["Một", "Hai", "Ba"]) {
      expect(
        (await call(hub, "POST", "/conversations", { token: lan, body: { title: t } })).status,
      ).toBe(201);
    }
    const all = (await call(hub, "GET", "/conversations?limit=200", { token: lan })).json.items.map(
      (x: { id: string }) => x.id,
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor ? `limit=1&cursor=${encodeURIComponent(cursor)}` : "limit=1";
      const page = ChatPageSchema(ConversationSchema).parse(
        (await call(hub, "GET", `/conversations?${q}`, { token: lan })).json,
      );
      seen.push(...page.items.map((x) => x.id));
      cursor = page.next_cursor;
    } while (cursor && seen.length <= all.length);
    expect(seen).toEqual(all);
    expect(all.length).toBe(4);
  });
});

describe("E10–E11 · chủ hội thoại: flow, tin [HUB-FR-45]", () => {
  it("HUB-FR-45 · E10 preview + active_run_id; E11 tăng dần, run tóm tắt, cursor trang cũ hơn", async () => {
    const flows = ChatPageSchema(FlowSchema).parse(
      (await call(hub, "GET", `/conversations/${R.conv}/flows`, { token: lan })).json,
    );
    // Cùng created_at (fixture một câu INSERT) → hoà theo id tăng.
    expect(flows.items.map((f) => [f.id, f.active_run_id])).toEqual([
      [R.flow, null],
      [R.flow2, R.runLive],
    ]);
    const conv = await call(hub, "GET", `/conversations/${R.conv}`, { token: lan });
    expect(ConversationSchema.parse(conv.json).flow_count).toBe(2);
    const f1 = flows.items.find((f) => f.id === R.flow);
    expect(f1?.preview.question.id).toBe(R.msgU1);
    expect(f1?.preview.answer?.run?.status).toBe("finished");
    const all = ChatPageSchema(MessageSchema).parse(
      (await call(hub, "GET", `/conversations/${R.conv}/messages?limit=200`, { token: lan })).json,
    );
    expect(all.items.length).toBe(4);
    const p1 = ChatPageSchema(MessageSchema).parse(
      (await call(hub, "GET", `/conversations/${R.conv}/messages?limit=3`, { token: lan })).json,
    );
    expect(p1.items.map((m) => m.id)).toEqual(all.items.slice(1).map((m) => m.id));
    const cur = encodeURIComponent(p1.next_cursor ?? "");
    const p2 = ChatPageSchema(MessageSchema).parse(
      (
        await call(hub, "GET", `/conversations/${R.conv}/messages?limit=3&cursor=${cur}`, {
          token: lan,
        })
      ).json,
    );
    expect(p2).toEqual({ items: all.items.slice(0, 1), next_cursor: null });
    const byFlow = await call(hub, "GET", `/conversations/${R.conv}/messages?flow_id=${R.anFlow}`, {
      token: lan,
    });
    expect(errorOf(byFlow)).toEqual(err("NOT_FOUND"));
  });
});

describe("E8–E9 · chủ hội thoại: đổi tên, xoá mềm [HUB-FR-40]", () => {
  it("HUB-FR-40 · E8 đổi tên → title_norm mới; body tenant_id → 400; E9 → 204 rồi 404", async () => {
    const created = (
      await call(hub, "POST", "/conversations", { token: lan, body: { title: "Tạm" } })
    ).json;
    const p = `/conversations/${created.id}`;
    const bad = await call(hub, "PATCH", p, {
      token: lan,
      body: { title: "x", tenant_id: USERS.an.tid },
    });
    expect(errorOf(bad)).toEqual(err("VALIDATION_ERROR"));
    const ren = await call(hub, "PATCH", p, { token: lan, body: { title: "  Kế hoạch Đà Nẵng " } });
    expect(ConversationSchema.parse(ren.json).title).toBe("Kế hoạch Đà Nẵng");
    const [row] = await sql`select title_norm from hub.conversations where id = ${created.id}`;
    expect(row?.title_norm).toBe("ke hoach da nang");
    expect((await call(hub, "DELETE", p, { token: lan })).status).toBe(204);
    for (const [m, path] of [
      ["GET", p],
      ["DELETE", p],
      ["GET", `${p}/flows`],
      ["GET", `${p}/messages`],
    ]) {
      expect(errorOf(await call(hub, m as string, path as string, { token: lan }))).toEqual(
        err("NOT_FOUND"),
      );
    }
  });
});
