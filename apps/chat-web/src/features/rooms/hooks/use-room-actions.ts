// HUB-FR-96…101 · mutation phòng. Vá cache bằng `room-cache`; lỗi giữ nguyên `ApiError` để UI dịch qua `roomErrorKeyOf`.
import type { CreateRoomRequest, RoomDetail } from "@ai/contracts/chat";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addRoomMembers,
  createRoom,
  deleteRoom,
  hideRoom,
  leaveRoom,
  markRoomRead,
  removeRoomMember,
  renameRoom,
  type SentRoomMessage,
  sendRoomMessage,
  transferRoom,
} from "../api";
import {
  applySentMessage,
  findRoomInList,
  insertMessage,
  patchRoomInList,
  patchUnreadTotal,
  type RoomListData,
  type RoomMessagesData,
  removeRoomFromList,
  roomKeys,
} from "../lib/room-cache";

const refreshList = (qc: QueryClient) => qc.invalidateQueries({ queryKey: roomKeys.list });

function setDetail(qc: QueryClient, d: RoomDetail): void {
  qc.setQueryData(roomKeys.detail(d.id), d);
  void refreshList(qc);
}

function dropRoom(qc: QueryClient, id: string): void {
  qc.setQueryData<RoomListData>(roomKeys.list, (d) => removeRoomFromList(d, id));
  qc.removeQueries({ queryKey: roomKeys.detail(id) });
  qc.removeQueries({ queryKey: roomKeys.messages(id) });
}

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRoomRequest) => createRoom(body),
    onSuccess: (d) => setDetail(qc, d),
  });
}

export function useRenameRoom(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => renameRoom(id, name),
    onSuccess: (d) => setDetail(qc, d),
  });
}

export function useAddRoomMembers(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) => addRoomMembers(id, userIds),
    onSuccess: (d) => setDetail(qc, d),
  });
}

export function useTransferRoom(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => transferRoom(id, userId),
    onSuccess: (d) => setDetail(qc, d),
  });
}

export function useRemoveRoomMember(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeRoomMember(id, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.detail(id) });
      void refreshList(qc);
    },
  });
}

/** Xoá nhóm / rời nhóm / ẩn DM: phòng biến khỏi list và cache của nó. */
export function useRoomExit(id: string, kind: "delete" | "leave" | "hide") {
  const qc = useQueryClient();
  const fn = { delete: deleteRoom, leave: leaveRoom, hide: hideRoom }[kind];
  return useMutation({ mutationFn: () => fn(id), onSuccess: () => dropRoom(qc, id) });
}

/** Gửi tin (idempotent theo `client_msg_id`): chèn khử trùng, đưa phòng lên đầu, `unread=0`. */
export function useSendRoomMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { content: string; client_msg_id: string }) => sendRoomMessage(id, v),
    onSuccess: ({ message: msg }: SentRoomMessage) => {
      qc.setQueryData<RoomMessagesData>(roomKeys.messages(id), (d) => insertMessage(d, msg));
      qc.setQueryData<RoomListData>(roomKeys.list, (d) => applySentMessage(d, id, msg));
      if (!findRoomInList(qc.getQueryData<RoomListData>(roomKeys.list), id)) void refreshList(qc);
    },
  });
}

/** `POST /read`: kết quả vá `unread` của phòng + `unread_total`. */
export function useMarkRoomRead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seq: number) => markRoomRead(id, seq),
    onSuccess: (r) => {
      qc.setQueryData<RoomListData>(roomKeys.list, (d) =>
        patchUnreadTotal(patchRoomInList(d, id, { unread: r.unread }), r.unread_total),
      );
    },
  });
}
