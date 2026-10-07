// HUB-FR-96…101 · toàn bộ gọi `/rooms*` (spec §3). Gọi API chỉ ở file này (plan-frontend §1).
import {
  type CreateRoomRequest,
  type MarkRoomReadResponse,
  MarkRoomReadResponseSchema,
  type RoomDetail,
  RoomDetailSchema,
  type RoomListResponse,
  RoomListResponseSchema,
  type RoomMessage,
  type RoomMessagePage,
  RoomMessagePageSchema,
  RoomMessageSchema,
  type SendRoomMessageRequest,
} from "@ai/contracts/chat";
import { api } from "~/lib/http";

const base = (id: string) => `/rooms/${encodeURIComponent(id)}`;

export async function listRooms(cursor?: string, signal?: AbortSignal): Promise<RoomListResponse> {
  return RoomListResponseSchema.parse(await api<unknown>("/rooms", { query: { cursor }, signal }));
}

export async function createRoom(body: CreateRoomRequest): Promise<RoomDetail> {
  return RoomDetailSchema.parse(await api<unknown>("/rooms", { method: "POST", body }));
}

export async function getRoom(id: string, signal?: AbortSignal): Promise<RoomDetail> {
  return RoomDetailSchema.parse(await api<unknown>(base(id), { signal }));
}

export async function renameRoom(id: string, name: string): Promise<RoomDetail> {
  return RoomDetailSchema.parse(await api<unknown>(base(id), { method: "PATCH", body: { name } }));
}

export async function deleteRoom(id: string): Promise<void> {
  await api<void>(base(id), { method: "DELETE" });
}

export async function addRoomMembers(id: string, userIds: string[]): Promise<RoomDetail> {
  return RoomDetailSchema.parse(
    await api<unknown>(`${base(id)}/members`, { method: "POST", body: { user_ids: userIds } }),
  );
}

export async function removeRoomMember(id: string, userId: string): Promise<void> {
  await api<void>(`${base(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export async function leaveRoom(id: string): Promise<void> {
  await api<void>(`${base(id)}/leave`, { method: "POST" });
}

export async function transferRoom(id: string, userId: string): Promise<RoomDetail> {
  return RoomDetailSchema.parse(
    await api<unknown>(`${base(id)}/transfer`, { method: "POST", body: { user_id: userId } }),
  );
}

export async function hideRoom(id: string): Promise<void> {
  await api<void>(`${base(id)}/hide`, { method: "POST" });
}

/** Trang tin lùi theo `before_seq` (trang đầu = tin mới nhất); `items` seq tăng dần. */
export async function listRoomMessages(
  id: string,
  beforeSeq?: number,
  signal?: AbortSignal,
): Promise<RoomMessagePage> {
  return RoomMessagePageSchema.parse(
    await api<unknown>(`${base(id)}/messages`, { query: { before_seq: beforeSeq }, signal }),
  );
}

/** 201 mới / 200 trùng `client_msg_id`: cùng một thân `RoomMessage`. */
export async function sendRoomMessage(
  id: string,
  body: SendRoomMessageRequest,
): Promise<RoomMessage> {
  return RoomMessageSchema.parse(
    await api<unknown>(`${base(id)}/messages`, { method: "POST", body }),
  );
}

export async function markRoomRead(id: string, seq: number): Promise<MarkRoomReadResponse> {
  return MarkRoomReadResponseSchema.parse(
    await api<unknown>(`${base(id)}/read`, { method: "POST", body: { seq } }),
  );
}
