// CR-169 · lát 5a · gắn `@ai/messages-web` với transport/luồng/phiên của workspace-web.
import { configureMessagesHost } from "@ai/messages-web/host";
import { api } from "@ai/web-kit/http";
import { useSession } from "~/features/auth/hooks/use-session";
import { session } from "~/features/auth/lib/session";
import { meStream } from "~/platform/stream/me-stream";

configureMessagesHost({
  api,
  subscribe: (event, handler, onReconnected) => meStream.subscribe(event, handler, onReconnected),
  myId: () => session.getState().me?.id,
  useScope: () => useSession((s) => (s.me ? `${s.me.tenant.id}:${s.me.id}` : "")),
});
