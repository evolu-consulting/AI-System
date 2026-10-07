// HUB-FR-99 · unit `/me/stream`: parse entry, `XINFO`, quyết định nối lại, giới hạn kết nối, frame (X2a plan §7).
import { describe, expect, test } from "bun:test";
import { MeStreamConns, resumePlan, userEntryFrame } from "./me-stream.session";
import { parseFields, streamInfoOf } from "./user-stream-reader";

const ROOM = "a2a00000-0000-4000-8000-000000000001";
const USER = "a2a00000-0000-4000-8000-000000000002";
const readBody = JSON.stringify({
  event: "room.read",
  data: { room_id: ROOM, user_id: USER, seq: 3 },
});

describe("HUB-FR-99 · parseFields", () => {
  test("HUB-FR-99 · entry đúng contract ⇒ sự kiện; sai/thiếu/stream.reset ⇒ null", () => {
    expect(parseFields(["e", readBody])).toEqual({
      event: "room.read",
      data: { room_id: ROOM, user_id: USER, seq: 3 },
    });
    expect(parseFields(["x", readBody])).toBeNull();
    expect(parseFields(["e", "{hỏng"])).toBeNull();
    expect(parseFields(["e", JSON.stringify({ event: "stream.reset", data: {} })])).toBeNull();
    expect(
      parseFields(["e", JSON.stringify({ event: "room.read", data: { room_id: ROOM } })]),
    ).toBeNull();
  });
});

describe("HUB-FR-99 · streamInfoOf", () => {
  test("HUB-FR-99 · mảng phẳng RESP2, Map RESP3; thiếu max-deleted ⇒ 0-0", () => {
    const flat = ["length", 3, "last-generated-id", "5-1", "max-deleted-entry-id", "2-0"];
    // Không cắt (entries-added = length) ⇒ giữ max-deleted (XDEL).
    expect(streamInfoOf(flat)).toEqual({ lastGenerated: "5-1", maxDeleted: "2-0" });
    expect(streamInfoOf(new Map([["last-generated-id", "7-0"]]))).toEqual({
      lastGenerated: "7-0",
      maxDeleted: "0-0",
    });
  });
});

describe("HUB-FR-99 · streamInfoOf sau MAXLEN (Redis 7.4 max-deleted vẫn 0-0)", () => {
  test("HUB-FR-99 · đã cắt ⇒ maxDeleted = entry đầu còn giữ; rỗng ⇒ id cuối", () => {
    const base = ["last-generated-id", "9-6", "max-deleted-entry-id", "0-0", "entries-added", 1100];
    expect(streamInfoOf([...base, "length", 1000, "recorded-first-entry-id", "5-6"])).toEqual({
      lastGenerated: "9-6",
      maxDeleted: "5-6",
    });
    expect(streamInfoOf([...base, "length", 1000, "first-entry", ["4-0", ["e", "x"]]])).toEqual({
      lastGenerated: "9-6",
      maxDeleted: "4-0",
    });
    expect(streamInfoOf([...base, "length", 0])).toEqual({
      lastGenerated: "9-6",
      maxDeleted: "9-6",
    });
  });
});

describe("HUB-FR-99 · resumePlan", () => {
  const reader = (info: { lastGenerated: string; maxDeleted: string } | null, last = "9-0") => ({
    info: async () => info,
    lastId: async () => last,
  });
  const live = { lastGenerated: "9-0", maxDeleted: "3-0" };

  test("HUB-FR-99 · vắng/rỗng ⇒ tail từ id cuối; sai định dạng ⇒ reset + tail", async () => {
    expect(await resumePlan(reader(live), USER, undefined)).toEqual({
      reset: false,
      replay: false,
      from: "9-0",
    });
    expect(await resumePlan(reader(live), USER, "")).toEqual({
      reset: false,
      replay: false,
      from: "9-0",
    });
    expect(await resumePlan(reader(live), USER, "abc")).toEqual({
      reset: true,
      replay: false,
      from: "9-0",
    });
  });

  test("HUB-FR-99 · id còn giữ ⇒ replay; đã cắt / quá đỉnh / key mất ⇒ reset", async () => {
    expect(await resumePlan(reader(live), USER, "5-0")).toEqual({
      reset: false,
      replay: true,
      from: "5-0",
    });
    expect((await resumePlan(reader(live), USER, "2-0")).reset).toBe(true);
    expect((await resumePlan(reader(live), USER, "10-0")).reset).toBe(true);
    expect(await resumePlan(reader(null, "0-0"), USER, "1-0")).toEqual({
      reset: true,
      replay: false,
      from: "0-0",
    });
  });
});

describe("HUB-FR-99 · MeStreamConns", () => {
  test("HUB-FR-99 · phiên thứ 6 đẩy phiên cũ nhất ra; remove giảm đếm", () => {
    const conns = new MeStreamConns();
    const ended: number[] = [];
    const ss = Array.from({ length: 6 }, (_, i) => ({ end: () => ended.push(i) }));
    for (const s of ss) conns.add(USER, s);
    expect(ended).toEqual([0]);
    expect(conns.count(USER)).toBe(6);
    conns.remove(USER, ss[0] as (typeof ss)[number]);
    expect(conns.count(USER)).toBe(5);
  });
});

describe("HUB-FR-99 · userEntryFrame", () => {
  test("HUB-FR-99 · frame có id Redis + event + data JSON", () => {
    const frame = userEntryFrame({
      id: "5-1",
      ev: { event: "room.deleted", data: { room_id: ROOM } },
    });
    expect(frame).toBe(`id: 5-1\nevent: room.deleted\ndata: {"room_id":"${ROOM}"}\n\n`);
  });
});
