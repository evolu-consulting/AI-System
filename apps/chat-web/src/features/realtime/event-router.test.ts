// HUB-FR-100, CHAT-AC-37…40, X2a-AC08 · mỗi sự kiện /me/stream → cache TanStack Query (plan-frontend §3).
import { beforeEach, describe, expect, test } from "bun:test";
import type {
  AttachmentRef,
  MeStreamEvent,
  RoomDetail,
  RoomMessage,
  RoomSummary,
} from "@ai/contracts/chat";
import { parseMeStreamEvent } from "@ai/contracts/chat";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  type RoomListData,
  type RoomMessagesData,
  roomKeys,
} from "~/features/rooms/lib/room-cache";
import { createEventRouter, type RoomLostReason, type RoutedEvent } from "./event-router";

const AT = "2026-10-07T00:00:00.000Z";
const LATER = "2026-10-07T01:00:00.000Z";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = uid(900);
const OTHER = uid(901);

const room = (n: number, over: Partial<RoomSummary> = {}): RoomSummary => ({
  id: uid(n),
  kind: "group",
  name: `R${n}`,
  peer: null,
  member_count: 2,
  my_role: "member",
  last_message: null,
  last_seq: 0,
  unread: 0,
  last_activity_at: AT,
  ...over,
});
const detail = (n: number): RoomDetail => ({
  ...room(n),
  owner_id: OTHER,
  created_at: AT,
  members: [
    { id: ME, display_name: "Me", username: "me", role: "member", last_read_seq: 1, joined_at: AT },
    { id: OTHER, display_name: "O", username: "o", role: "owner", last_read_seq: 0, joined_at: AT },
  ],
});
const msg = (n: number, seq: number, content = "xin chào"): RoomMessage => ({
  id: uid(100 + seq),
  room_id: uid(n),
  seq,
  sender_type: "user",
  sender: { id: OTHER, display_name: "O" },
  content,
  client_msg_id: null,
  created_at: LATER,
});

let client: QueryClient;
let lost: [string, RoomLostReason][];
let route: (e: RoutedEvent) => void;

const seedList = (...rs: RoomSummary[]) =>
  client.setQueryData<RoomListData>(roomKeys.list, {
    pages: [{ items: rs, next_cursor: null, unread_total: 4 }],
    pageParams: [undefined],
  });
const items = () =>
  client.getQueryData<RoomListData>(roomKeys.list)?.pages.flatMap((p) => p.items) ?? [];

beforeEach(() => {
  client = new QueryClient();
  lost = [];
  route = createEventRouter({
    client,
    myId: () => ME,
    onRoomLost: (id, reason) => lost.push([id, reason]),
  });
});

describe("room.message", () => {
  test("chèn vào messages đã nạp (khử trùng), cập nhật last_message và đưa phòng lên đầu", () => {
    seedList(room(1), room(2));
    client.setQueryData<RoomMessagesData>(roomKeys.messages(uid(2)), {
      pages: [{ items: [msg(2, 1)], has_more: false }],
      pageParams: [undefined],
    });
    const ev: MeStreamEvent = {
      event: "room.message",
      data: { room_id: uid(2), message: msg(2, 2) },
    };
    route(ev);
    route(ev);
    const m = client.getQueryData<RoomMessagesData>(roomKeys.messages(uid(2)));
    expect(m?.pages[0]?.items.map((x) => x.seq)).toEqual([1, 2]);
    expect(items().map((r) => r.id)).toEqual([uid(2), uid(1)]);
    expect(items()[0]?.last_message?.preview).toBe("xin chào");
    expect(items()[0]?.last_seq).toBe(2);
  });

  test("messages chưa nạp thì không tạo cache; phòng lạ → invalidate list", () => {
    seedList(room(1));
    route({ event: "room.message", data: { room_id: uid(7), message: msg(7, 1) } });
    expect(client.getQueryData(roomKeys.messages(uid(7)))).toBeUndefined();
    expect(client.getQueryState(roomKeys.list)?.isInvalidated).toBe(true);
  });
});

// Truy vấn tin tải lần đầu (TS1 · #234): helper dùng chung cho các ca bên dưới.
/** Xả hàng đợi microtask (huỷ + tải lại của TanStack chạy qua promise); không chờ mốc giờ. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Truy vấn tin còn bay: lượt tải đầu chụp danh sách TRƯỚC khi tin được đăng; lượt tải lại (sau sự kiện) có tin. */
function firstLoad(key: readonly unknown[]) {
  const calls: { release: (items: RoomMessage[]) => void; aborted: boolean }[] = [];
  // Có observer (như `useInfiniteQuery` của khung flow) thì invalidate mới tải lại.
  const obs = new QueryObserver<RoomMessagesData>(client, {
    queryKey: key,
    retry: false,
    queryFn: ({ signal }) =>
      new Promise<RoomMessagesData>((resolve) => {
        const call = {
          aborted: false,
          release: (items: RoomMessage[]) =>
            resolve({ pages: [{ items, has_more: false }], pageParams: [undefined] }),
        };
        signal.addEventListener("abort", () => {
          call.aborted = true;
        });
        calls.push(call);
      }),
  });
  const off = obs.subscribe(() => undefined);
  return { calls, off };
}

describe("TS1 · #234 · tin tới khi truy vấn tin đang tải lần đầu", () => {
  test("tin tới giữa lúc tải lần đầu ⇒ tải lại, tin có trong kết quả (không rơi khỏi cache)", async () => {
    seedList(room(3));
    const key = roomKeys.messages(uid(3));
    const { calls, off } = firstLoad(key);
    expect(client.getQueryState(key)?.fetchStatus).toBe("fetching");
    // sự kiện tới trước khi response đầu về: cache chưa có data nên setQueryData bỏ qua
    route({ event: "room.message", data: { room_id: uid(3), message: msg(3, 2) } });
    expect(client.getQueryData(key)).toBeUndefined();
    await flush();
    // lượt tải mới (sau commit) có cả hai tin; lượt cũ bị huỷ nên không ghi đè
    expect(calls.length).toBeGreaterThanOrEqual(2);
    calls.at(-1)?.release([msg(3, 1), msg(3, 2)]);
    await client.getQueryCache().find({ queryKey: key })?.promise;
    expect(client.getQueryData<RoomMessagesData>(key)?.pages[0]?.items.map((x) => x.seq)).toEqual([
      1, 2,
    ]);
    off();
  });

  test("tin có flow_id tới khi flow đang tải lần đầu ⇒ cũng tải lại flow", async () => {
    seedList(room(4));
    const flowId = uid(55);
    const key = roomKeys.flow(uid(4), flowId);
    const { calls, off } = firstLoad(key);
    route({
      event: "room.message",
      data: { room_id: uid(4), message: { ...msg(4, 2), placement: "flow", flow_id: flowId } },
    });
    await flush();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    off();
  });

  test("truy vấn đã có data hoặc không tải ⇒ không tải lại (vá cache như cũ)", () => {
    seedList(room(5));
    const key = roomKeys.messages(uid(5));
    client.setQueryData<RoomMessagesData>(key, {
      pages: [{ items: [msg(5, 1)], has_more: false }],
      pageParams: [undefined],
    });
    route({ event: "room.message", data: { room_id: uid(5), message: msg(5, 2) } });
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(client.getQueryData<RoomMessagesData>(key)?.pages[0]?.items.map((x) => x.seq)).toEqual([
      1, 2,
    ]);
  });
});

test("X2b-2: tin có attachments qua parseMeStreamEvent, vào cache nguyên tệp, khử trùng", () => {
  const file: AttachmentRef = {
    id: uid(70),
    filename: "a.pdf",
    mime: "application/pdf",
    size: 9,
    available: true,
  };
  const message = { ...msg(2, 3), attachments: [file] };
  const parsed = parseMeStreamEvent("room.message", JSON.stringify({ room_id: uid(2), message }));
  expect(parsed).not.toBeNull();
  client.setQueryData<RoomMessagesData>(roomKeys.messages(uid(2)), {
    pages: [{ items: [msg(2, 1)], has_more: false }],
    pageParams: [undefined],
  });
  seedList(room(2));
  if (parsed) {
    route(parsed);
    route(parsed);
  }
  const got = client.getQueryData<RoomMessagesData>(roomKeys.messages(uid(2)))?.pages[0]?.items;
  expect(got?.map((x) => x.seq)).toEqual([1, 3]);
  expect(got?.[1]?.attachments).toEqual([file]);
});

test("room.unread vá unread phòng + unread_total", () => {
  seedList(room(1), room(2, { unread: 1 }));
  route({ event: "room.unread", data: { room_id: uid(2), unread: 5, total: 9 } });
  expect(items()[1]?.unread).toBe(5);
  expect(client.getQueryData<RoomListData>(roomKeys.list)?.pages[0]?.unread_total).toBe(9);
});

test("room.read: last_read_seq = max(cũ, seq)", () => {
  client.setQueryData(roomKeys.detail(uid(1)), detail(1));
  route({ event: "room.read", data: { room_id: uid(1), user_id: OTHER, seq: 6 } });
  route({ event: "room.read", data: { room_id: uid(1), user_id: OTHER, seq: 2 } });
  const d = client.getQueryData<RoomDetail>(roomKeys.detail(uid(1)));
  expect(d?.members.find((m) => m.id === OTHER)?.last_read_seq).toBe(6);
});

describe("thành viên", () => {
  test("tôi được thêm + có room → chèn vào list", () => {
    seedList(room(1));
    route({
      event: "room.member_added",
      data: { room_id: uid(2), user_id: ME, room: room(2) },
    });
    expect(items().map((r) => r.id)).toEqual([uid(2), uid(1)]);
  });

  test("người khác được thêm/bớt → invalidate detail + list", () => {
    seedList(room(1));
    client.setQueryData(roomKeys.detail(uid(1)), detail(1));
    route({ event: "room.member_added", data: { room_id: uid(1), user_id: OTHER } });
    expect(client.getQueryState(roomKeys.detail(uid(1)))?.isInvalidated).toBe(true);
    expect(lost).toEqual([]);
  });

  test("tôi bị bớt → xoá khỏi list, removeQueries detail/messages, báo mất phòng", () => {
    seedList(room(1), room(2));
    client.setQueryData(roomKeys.detail(uid(1)), detail(1));
    client.setQueryData(roomKeys.messages(uid(1)), { pages: [], pageParams: [] });
    route({ event: "room.member_removed", data: { room_id: uid(1), user_id: ME } });
    expect(items().map((r) => r.id)).toEqual([uid(2)]);
    expect(client.getQueryData(roomKeys.detail(uid(1)))).toBeUndefined();
    expect(client.getQueryData(roomKeys.messages(uid(1)))).toBeUndefined();
    expect(lost).toEqual([[uid(1), "removed"]]);
  });
});

test("room.updated vá tên + owner_id, tính lại my_role", () => {
  seedList(room(1));
  client.setQueryData(roomKeys.detail(uid(1)), detail(1));
  route({ event: "room.updated", data: { room_id: uid(1), name: "Mới", owner_id: ME } });
  expect(items()[0]).toMatchObject({ name: "Mới", my_role: "owner" });
  const d = client.getQueryData<RoomDetail>(roomKeys.detail(uid(1)));
  expect(d).toMatchObject({ name: "Mới", owner_id: ME, my_role: "owner" });
});

test("room.deleted như bị bớt", () => {
  seedList(room(1));
  route({ event: "room.deleted", data: { room_id: uid(1) } });
  expect(items()).toEqual([]);
  expect(lost).toEqual([[uid(1), "deleted"]]);
});

test("stream.reset invalidate toàn bộ ['rooms'] mà không xoá cache", () => {
  seedList(room(1));
  client.setQueryData(roomKeys.detail(uid(1)), detail(1));
  route({ event: "stream.reset", data: {} });
  expect(items()).toHaveLength(1);
  expect(client.getQueryState(roomKeys.list)?.isInvalidated).toBe(true);
  expect(client.getQueryState(roomKeys.detail(uid(1)))?.isInvalidated).toBe(true);
});

// X2b · room.run_* + tin agent
const AGENT = { key: "hoadon", name: { vi: "hoadon", en: "hoadon" } };
const started = (n: number): RoutedEvent => ({
  event: "room.run_started",
  data: {
    room_id: uid(1),
    run_id: uid(700 + n),
    flow_id: uid(800 + n),
    trigger_message_id: uid(100 + n),
    agent: AGENT,
    caller: { id: OTHER, display_name: "O" },
  },
});
const runs = () => client.getQueryData<RoomDetail>(roomKeys.detail(uid(1)))?.active_runs ?? [];

test("X2b · started → thêm (khử trùng), waiting → cập nhật, finished → bỏ", () => {
  client.setQueryData(roomKeys.detail(uid(1)), detail(1));
  route(started(1));
  route(started(1));
  route(started(2));
  expect(runs().map((r) => r.run_id)).toEqual([uid(701), uid(702)]);
  route({
    event: "room.run_waiting",
    data: {
      room_id: uid(1),
      run_id: uid(701),
      flow_id: uid(801),
      caller_id: OTHER,
      kind: "side_effect",
    },
  });
  expect(runs()[0]).toMatchObject({ status: "waiting", wait_kind: "side_effect" });
  route({
    event: "room.run_finished",
    data: {
      room_id: uid(1),
      run_id: uid(701),
      flow_id: uid(801),
      status: "cancelled",
      message_id: null,
    },
  });
  expect(runs().map((r) => r.run_id)).toEqual([uid(702)]);
});

test("X2b · tin agent cùng run_id bỏ run chờ; tin placement=flow không vào timeline, tăng đếm khối gốc", () => {
  seedList(room(1));
  client.setQueryData(roomKeys.detail(uid(1)), detail(1));
  route(started(2));
  const agentMsg: RoomMessage = {
    ...msg(1, 2, "HD-12"),
    sender_type: "agent",
    run_id: uid(702),
    flow_id: uid(802),
    caller: { id: OTHER, display_name: "O" },
    flow: { message_count: 2, last_active_at: AT },
  };
  client.setQueryData<RoomMessagesData>(roomKeys.messages(uid(1)), {
    pages: [{ items: [msg(1, 1)], has_more: false }],
    pageParams: [undefined],
  });
  route({ event: "room.message", data: { room_id: uid(1), message: agentMsg } });
  expect(runs()).toEqual([]);
  route({
    event: "room.message",
    data: {
      room_id: uid(1),
      message: { ...msg(1, 3, "tiếp"), flow_id: uid(802), placement: "flow" },
    },
  });
  const items = client.getQueryData<RoomMessagesData>(roomKeys.messages(uid(1)))?.pages[0]?.items;
  expect(items?.map((x) => x.seq)).toEqual([1, 2]);
  expect(items?.[1]?.flow).toEqual({ message_count: 3, last_active_at: LATER });
});

describe("P-a · tin sender_type=process (thread §6 #1)", () => {
  const RUN = uid(700);
  const processMsg = (kind: "block" | "output"): RoomMessage => ({
    ...msg(1, 5, "Quy trình …"),
    sender_type: "process",
    sender: { id: uid(950), display_name: "Quy trình" },
    process_run_id: RUN,
    process: { kind } as RoomMessage["process"],
  });

  test("tin process (không phải block) invalidate view run, không đụng active_runs", () => {
    seedList(room(1));
    const key = ["process", "run", RUN] as const;
    client.setQueryData(key, { id: RUN });
    client.setQueryData<RoomDetail>(roomKeys.detail(uid(1)), { ...detail(1), active_runs: [] });
    route({ event: "room.message", data: { room_id: uid(1), message: processMsg("output") } });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryData<RoomDetail>(roomKeys.detail(uid(1)))?.active_runs).toEqual([]);
  });

  test("tin block không invalidate; sender process vào list như tin thường", () => {
    seedList(room(1));
    const key = ["process", "run", RUN] as const;
    client.setQueryData(key, { id: RUN });
    route({ event: "room.message", data: { room_id: uid(1), message: processMsg("block") } });
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(items()[0]?.last_message?.sender_type).toBe("process");
  });

  test("stream.reset làm tươi cả cache quy trình, giữ cờ engine", () => {
    client.setQueryData(["process", "engine"], "on");
    client.setQueryData(["process", "run", RUN], { id: RUN });
    route({ event: "stream.reset", data: {} });
    expect(client.getQueryState(["process", "run", RUN])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["process", "engine"])?.isInvalidated).toBe(false);
  });
});
