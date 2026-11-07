// ADR-0037 · cửa công khai DUY NHẤT của module `rooms`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export { lockFor } from "./manage/rooms.service";
export type { RoomProcessSender, SendResult } from "./messages/messages.service";
export { advanceRead, bumpSeq, fanout, findByClientId } from "./messages/messages.service";
export type { FanoutRow } from "./room-events";
export { messageEvents } from "./room-events";
export { toRoomMessage } from "./rooms.map";
