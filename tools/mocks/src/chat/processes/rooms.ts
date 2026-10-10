// HUB-FR-113 · U1 · phòng R của fixture quy trình: `GET /rooms/:id` + `GET /rooms/:id/messages[?flow_id]` (khối gốc ở
// main mang `flow{…recent}`, thread = tin `flow`). Chỉ phòng R; danh sách `/rooms` của stub X2a giữ nguyên.
import {
  ROOM_FLOW_RECENT_MAX,
  ROOM_PREVIEW_MAX,
  type RoomDetail,
  type RoomMessage,
  RoomMessageListQuerySchema,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { ChatVars } from "../auth";
import { parseWith } from "../http";
import { findUserById } from "../users";
import { at, PA_FIX, PERSONA } from "./fixtures";
import { invalid, me, notFound } from "./http";
import type { ProcessState } from "./state";

const preview = (m: RoomMessage) => m.content.slice(0, ROOM_PREVIEW_MAX);

function withFlow(s: ProcessState, m: RoomMessage): RoomMessage {
  if (m.placement !== "main" || !m.flow_id) return m;
  const flow = s.messages.filter((x) => x.flow_id === m.flow_id && x.placement === "flow");
  return {
    ...m,
    flow: {
      message_count: flow.length,
      last_active_at: flow.at(-1)?.created_at ?? m.created_at,
      recent: flow.slice(-ROOM_FLOW_RECENT_MAX).map((x) => ({
        id: x.id,
        seq: x.seq,
        sender_type: x.sender_type,
        sender: x.sender,
        preview: preview(x),
        created_at: x.created_at,
        unread: false,
        ...(x.process ? { process: { kind: x.process.kind } } : {}),
      })),
      unread: 0,
    },
  };
}

function detail(s: ProcessState, viewer: string): RoomDetail {
  const last = s.messages.at(-1);
  const members = s.roomMembers().map((id) => {
    const u = findUserById(id);
    return {
      id,
      display_name: u?.display_name ?? "?",
      username: u?.username ?? "?",
      role: id === PERSONA.A.id ? ("owner" as const) : ("member" as const),
      last_read_seq: last?.seq ?? 0,
      joined_at: at(0),
    };
  });
  return {
    id: PA_FIX.room,
    kind: "group",
    name: "Phòng R",
    peer: null,
    member_count: members.length,
    my_role: viewer === PERSONA.A.id ? "owner" : "member",
    last_message: last
      ? {
          seq: last.seq,
          sender_type: last.sender_type,
          sender: last.sender,
          preview: preview(last),
          created_at: last.created_at,
        }
      : null,
    last_seq: last?.seq ?? 0,
    unread: 0,
    last_activity_at: last?.created_at ?? at(0),
    owner_id: PERSONA.A.id,
    created_at: at(0),
    members,
  };
}

export function createProcessRoomRoutes(s: ProcessState): Hono<ChatVars> {
  const app = new Hono<ChatVars>();
  const isMember = (c: Parameters<typeof me>[0]) =>
    c.req.param("id") === PA_FIX.room && s.roomMembers().includes(me(c));

  app.get("/rooms/:id", (c) => (isMember(c) ? c.json(detail(s, me(c))) : notFound(c)));

  app.get("/rooms/:id/messages", (c) => {
    if (!isMember(c)) return notFound(c);
    const q = parseWith(RoomMessageListQuerySchema, c.req.query());
    if (!q.ok) return invalid(c, q);
    const { flow_id, before_seq, limit } = q.data;
    const all = s.messages
      .filter((m) =>
        flow_id ? m.flow_id === flow_id && m.placement === "flow" : m.placement === "main",
      )
      .filter((m) => before_seq === undefined || m.seq < before_seq);
    const items = all.slice(-limit).map((m) => withFlow(s, m));
    return c.json({ items, has_more: all.length > items.length });
  });

  return app;
}
