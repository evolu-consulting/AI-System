// CR-169 · lát 5a/5b · gắn `@ai/messages-web` với transport/luồng/phiên/giao diện nền của workspace-web.
import { configureMessagesHost } from "@ai/messages-web/host";
import { api, apiResponse } from "@ai/web-kit/http";
import { confirmDialog } from "~/components/shared/dialog-bus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Skeleton } from "~/components/ui/skeleton";
import { useSession } from "~/features/auth/hooks/use-session";
import { session } from "~/features/auth/lib/session";
import { cn } from "~/lib/utils";
import { meStream } from "~/platform/stream/me-stream";

configureMessagesHost({
  api,
  apiResponse,
  subscribe: (event, handler, onReconnected) => meStream.subscribe(event, handler, onReconnected),
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
});
