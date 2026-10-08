// HUB-FR-96…102 · api.ts rooms + directory với fetch giả: URL, method, body, parse zod, lỗi.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiError } from "~/lib/http";
import { fetchDirectory } from "../directory/api";
import {
  addRoomMembers,
  createRoom,
  hideRoom,
  listRoomMessages,
  listRooms,
  markRoomRead,
  removeRoomMember,
  sendRoomMessage,
} from "./api";

const AT = "2026-10-07T00:00:00.000Z";
const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const realFetch = globalThis.fetch;
let calls: { url: string; method: string; body?: unknown }[] = [];
let reply: { status: number; body?: unknown } = { status: 200, body: {} };

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
    });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const message = {
  id: U1,
  room_id: U2,
  seq: 1,
  sender_type: "user",
  sender: { id: U1, display_name: "A" },
  content: "hi",
  client_msg_id: U2,
  created_at: AT,
};

describe("rooms api", () => {
  test("listRooms: cursor vào query, parse trang", async () => {
    reply = { status: 200, body: { items: [], next_cursor: null, unread_total: 0 } };
    expect(await listRooms("abc")).toEqual({ items: [], next_cursor: null, unread_total: 0 });
    expect(calls[0]?.url).toBe("/rooms?cursor=abc");
  });
  test("listRooms: thân sai hợp đồng bị từ chối", async () => {
    reply = { status: 200, body: { items: [{}] } };
    await expect(listRooms()).rejects.toThrow();
  });
  test("createRoom: POST /rooms với thân DM", async () => {
    reply = { status: 500, body: { error: { code: "HTTP_ERROR", message: "x" } } };
    await expect(createRoom({ kind: "dm", user_id: U1 })).rejects.toBeInstanceOf(ApiError);
    expect(calls[0]).toMatchObject({
      url: "/rooms",
      method: "POST",
      body: { kind: "dm", user_id: U1 },
    });
  });
  test("lỗi phòng giữ mã contract", async () => {
    reply = { status: 409, body: { error: { code: "ROOM_FULL", message: "Room is full" } } };
    const err = await addRoomMembers(U1, [U2]).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("ROOM_FULL");
    expect(calls[0]).toMatchObject({ url: `/rooms/${U1}/members`, body: { user_ids: [U2] } });
  });
  test("204: removeRoomMember / hideRoom", async () => {
    reply = { status: 204 };
    await removeRoomMember(U1, U2);
    await hideRoom(U1);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `DELETE /rooms/${U1}/members/${U2}`,
      `POST /rooms/${U1}/hide`,
    ]);
  });
  test("listRoomMessages: before_seq + limit 30 (CR-051); sendRoomMessage / markRoomRead", async () => {
    reply = { status: 200, body: { items: [message], has_more: true } };
    expect((await listRoomMessages(U1, 40)).has_more).toBe(true);
    expect(calls[0]?.url).toBe(`/rooms/${U1}/messages?before_seq=40&limit=30`);
    reply = { status: 201, body: message };
    const sent = await sendRoomMessage(U1, { content: "hi", client_msg_id: U2 });
    expect([sent.message.seq, sent.runId, sent.flowId]).toEqual([1, null, null]);
    expect(calls[1]?.body).toEqual({ content: "hi", client_msg_id: U2 });
    reply = { status: 200, body: { unread: 0, unread_total: 2 } };
    expect(await markRoomRead(U1, 5)).toEqual({ unread: 0, unread_total: 2 });
    expect(calls[2]?.body).toEqual({ seq: 5 });
  });
});

describe("directory api", () => {
  test("fetchDirectory: q cắt khoảng trắng, q rỗng bỏ khỏi query; luôn xin tối đa 50 (CR-050)", async () => {
    reply = {
      status: 200,
      body: { items: [{ id: U1, display_name: "Minh", username: "minh", active: true }] },
    };
    expect((await fetchDirectory("  mi ")).items).toHaveLength(1);
    await fetchDirectory("");
    expect(calls.map((c) => c.url)).toEqual(["/directory?q=mi&limit=50", "/directory?limit=50"]);
  });
});
