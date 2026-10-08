// HUB-FR-97, HUB-FR-98 · bộ dialog quản lý phòng, nạp lazy theo loại đang mở (chunk riêng, không vào bundle đầu).
import type { RoomDetail } from "@ai/contracts/chat";
import { lazy, Suspense } from "react";

const MembersDialog = lazy(() =>
  import("./MembersDialog").then((m) => ({ default: m.MembersDialog })),
);
const AddMembersDialog = lazy(() =>
  import("./AddMembersDialog").then((m) => ({ default: m.AddMembersDialog })),
);
const RenameRoomDialog = lazy(() =>
  import("./RenameRoomDialog").then((m) => ({ default: m.RenameRoomDialog })),
);
const ExitRoomDialog = lazy(() =>
  import("./ExitRoomDialog").then((m) => ({ default: m.ExitRoomDialog })),
);

export type RoomDialogKind = "members" | "add" | "rename" | "delete" | "leave";

type Props = {
  room: RoomDetail;
  myId: string;
  kind: RoomDialogKind | null;
  onKind: (kind: RoomDialogKind | null) => void;
};

export function RoomDialogs({ room, myId, kind, onKind }: Props) {
  if (!kind) return null;
  const close = () => onKind(null);
  return (
    <Suspense fallback={null}>
      {kind === "members" && <MembersDialog room={room} myId={myId} onClose={close} />}
      {kind === "add" && <AddMembersDialog room={room} onClose={close} />}
      {kind === "rename" && <RenameRoomDialog room={room} onClose={close} />}
      {(kind === "delete" || kind === "leave") && (
        <ExitRoomDialog
          room={room}
          kind={kind}
          isOwner={room.owner_id === myId}
          onClose={close}
          onOpenMembers={() => onKind("members")}
        />
      )}
    </Suspense>
  );
}
