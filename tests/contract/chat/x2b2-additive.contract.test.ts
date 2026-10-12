// HUB-FR-44 · HUB-FR-101 · X2b2-AC01 · X2b2-AC13 · C01–C02 (test-plan X2b2 §4 — lưới phụ; khoá thật ở
// `tests/acceptance/X2b2/rules/contracts-x2b2.test.ts`): Hub trả đúng hình contract X2b-2 (chỉ thêm). C01 cần kho đính kèm
// (`POST /attachments`) ⇒ chỉ Hub thật (hub-dev); C02 (tin không file vắng `attachments`) chạy cả mock lẫn Hub thật.
import { describe, expect, it } from "bun:test";
import { FILENAME_HEADER, RoomMessagePageSchema, RoomMessageSchema } from "@ai/contracts/chat";
import { call, lazySession } from "./_client";
import { HUB_URL, isMock, USERS } from "./_env";

const lan = lazySession(USERS.a);
const stamp = () => Date.now().toString(36);
/** Trường X2b-2 đọc lỏng (contract chưa thêm lúc viết test ⇒ typecheck vẫn qua, ca đỏ lúc chạy). */
type WithAtt = { id: string; attachments?: { id: string }[] };

async function soloGroup(token: string, name: string): Promise<string> {
  const r = await call("POST", "/rooms", { token, body: { kind: "group", name, member_ids: [] } });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

describe.if(!isMock)("C01 · tin phòng có file (Hub thật) [X2b2-AC01, AC13]", () => {
  it("HUB-FR-44 · X2b2-AC01 · C01 · POST tin phòng + attachment_ids ⇒ 201 parse RoomMessageSchema (attachments 1); GET trang parse RoomMessagePageSchema", async () => {
    const token = (await lan()).access;
    const room = await soloGroup(token, `Phòng hợp đồng C01 ${stamp()}`);
    const pdf = new TextEncoder().encode(`%PDF-1.7\n${"A".repeat(2000)}`);
    const up = await fetch(`${HUB_URL}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        [FILENAME_HEADER]: encodeURIComponent("hop-dong.pdf"),
      },
      body: pdf,
    });
    expect(up.status).toBe(201);
    const id = ((await up.json()) as { id: string }).id;
    const sent = await call("POST", `/rooms/${room}/messages`, {
      token,
      body: { content: "hợp đồng C01", client_msg_id: crypto.randomUUID(), attachment_ids: [id] },
    });
    expect(sent.status).toBe(201);
    const msg = RoomMessageSchema.parse(await sent.json()) as WithAtt;
    expect(msg.attachments?.map((a) => a.id)).toEqual([id]);
    const page = await call("GET", `/rooms/${room}/messages`, { token });
    expect(page.status).toBe(200);
    const p = RoomMessagePageSchema.parse(await page.json()) as { items: WithAtt[] };
    expect(p.items.find((m) => m.id === msg.id)?.attachments?.map((a) => a.id)).toEqual([id]);
  });
});

describe("C02 · tin không file giữ hình cũ [X2b2-AC13]", () => {
  it("HUB-FR-44 · X2b2-AC13 · C02 · tin phòng không file ⇒ 201 + trang tin parse strict, khoá attachments VẮNG", async () => {
    const token = (await lan()).access;
    const room = await soloGroup(token, `Phòng thường C02 ${stamp()}`);
    const sent = await call("POST", `/rooms/${room}/messages`, {
      token,
      body: { content: "tin thường C02", client_msg_id: crypto.randomUUID() },
    });
    expect(sent.status).toBe(201);
    const raw = (await sent.json()) as Record<string, unknown>;
    RoomMessageSchema.parse(raw);
    expect(Object.hasOwn(raw, "attachments")).toBe(false);
    const page = await call("GET", `/rooms/${room}/messages`, { token });
    expect(page.status).toBe(200);
    RoomMessagePageSchema.parse(await page.json());
  });
});
