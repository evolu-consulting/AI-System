// feedback · int: gửi/xem của mình, cách ly user + tenant (RLS 0017), tenant_admin chỉ tenant mình, platform_admin thấy hết, trả lời hiện cho user.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { FeedbackItemSchema, FeedbackListResponseSchema } from "@ai/contracts";
import { createEnv, type Env } from "../../../../../tests/acceptance/M1/_fixtures";

let env: Env;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset();
});

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function send(tenant: string, user: string, message: string, app = "contracts") {
  const res = await env.post("/auth/feedback", {
    token: await env.token(tenant, user),
    body: {
      kind: "bug",
      message,
      app,
      page_url: "/contracts/1",
      app_version: "1.2.3",
      files: [{ name: "shot.png", mime: "image/png", data_base64: PNG }],
    },
  });
  expect(res.status).toBe(201);
  return FeedbackItemSchema.parse(res.json);
}

describe("feedback", () => {
  it("user A gửi; user B cùng tenant không đọc được; tenant_admin chỉ thấy tenant mình; trả lời hiện ở user", async () => {
    const a = await send("acme", "an", "lỗi của An");
    await send("globex", "an", "lỗi của globex");
    expect(a.files).toHaveLength(1);

    const tokAn = await env.token("acme", "an");
    const tokLan = await env.token("acme", "lan");
    const mine = FeedbackListResponseSchema.shape.items.parse(
      (await env.get("/auth/feedback", { token: tokAn })).json.items,
    );
    expect(mine.map((x) => x.id)).toEqual([a.id]);
    // user B: danh sách rỗng, tệp và PATCH admin đều bị chặn
    expect((await env.get("/auth/feedback", { token: tokLan })).json.items).toEqual([]);
    const fileUrl = `/auth/feedback/${a.id}/files/${a.files[0]?.id}`;
    expect((await env.get(fileUrl, { token: tokAn })).status).toBe(200);
    expect((await env.get(fileUrl, { token: tokLan })).status).toBe(404);
    expect((await env.get("/admin/feedback", { token: tokLan })).status).toBe(403);

    // tenant_admin acme: chỉ góp ý acme, kể cả khi ép tenant_id của globex
    const binh = await env.token("acme", "binh");
    const list = FeedbackListResponseSchema.parse(
      (await env.get("/admin/feedback", { token: binh })).json,
    );
    expect(list.items.map((x) => x.id)).toEqual([a.id]);
    const globexId = (
      await env.owner`select tenant_id from admin.feedback where message = 'lỗi của globex'`
    )[0]?.tenant_id;
    const forced = FeedbackListResponseSchema.parse(
      (await env.get(`/admin/feedback?tenant_id=${globexId}`, { token: binh })).json,
    );
    expect(forced.items.map((x) => x.id)).toEqual([a.id]);

    // đổi trạng thái + trả lời; user thấy
    const upd = await env.patch(`/admin/feedback/${a.id}`, {
      token: binh,
      body: { status: "done", reply: "Đã sửa" },
    });
    expect(upd.status).toBe(200);
    const after = FeedbackListResponseSchema.shape.items.parse(
      (await env.get("/auth/feedback", { token: tokAn })).json.items,
    );
    expect(after[0]).toMatchObject({ status: "done", reply: "Đã sửa" });

    // platform_admin thấy cả hai tenant; tenant_admin globex không sửa được góp ý acme
    const plat = await env.token("platform", "admin");
    const all = FeedbackListResponseSchema.parse(
      (await env.get("/admin/feedback", { token: plat })).json,
    );
    expect(all.total).toBe(2);
    const hoa = await env.token("globex", "hoa");
    expect(
      (await env.patch(`/admin/feedback/${a.id}`, { token: hoa, body: { status: "new" } })).status,
    ).toBe(404);
  });

  it("tệp sai chữ ký ⇒ 400 VALIDATION_ERROR", async () => {
    const res = await env.post("/auth/feedback", {
      token: await env.token("acme", "an"),
      body: {
        kind: "idea",
        message: "x",
        app: "chat",
        files: [
          { name: "a.png", mime: "image/png", data_base64: Buffer.from("nope").toString("base64") },
        ],
      },
    });
    expect(res.status).toBe(400);
  });
});
