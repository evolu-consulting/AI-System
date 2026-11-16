// CR-169 · lát 8 · gắn `@ai/messages-web` với transport/luồng/phiên/giao diện nền của chat-web (cùng gói, cùng dữ liệu với Sổ Hợp Tác).
import { configureMessagesHost } from "@ai/messages-web/host";
import { api, apiResponse } from "@ai/web-kit/http";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Skeleton } from "~/components/ui/skeleton";
import { confirmDialog } from "~/features/messages/lib/confirm-bus";
import { subscribeMsgFrames } from "~/features/realtime/msg-frames";
import { session } from "~/lib/auth/session";
import { useSession } from "~/lib/auth/use-session";
import { cn } from "~/lib/utils";

/** Một chỗ dựng host (test gọi lại được). */
export function messagesHostConfig(): Parameters<typeof configureMessagesHost>[0] {
  return {
    api,
    apiResponse,
    subscribe: subscribeMsgFrames,
    myId: () => session.getState().me?.id,
    useScope: () => useSession((s) => (s.me ? `${s.me.tenant.id}:${s.me.id}` : "")),
    useOwnCompany: () => {
      const t = useSession((s) => s.me?.tenant);
      return t ? { id: t.id, name: t.name } : null;
    },
    ui: {
      cn,
      Skeleton,
      Dialog,
      DialogContent,
      DialogHeader,
      DialogTitle,
      DialogDescription,
      confirm: confirmDialog,
    },
  };
}

configureMessagesHost(messagesHostConfig());
