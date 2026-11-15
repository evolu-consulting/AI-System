// CR-169 · quyền thấy mục «Tin nhắn»: một query dùng chung (key theo người dùng); lỗi/chưa tải ⇒ chưa cho thấy.
import { useQuery } from "@tanstack/react-query";
import { session } from "~/lib/auth/session";
import { useSession } from "~/lib/auth/use-session";
import { canUseMessages } from "../lib/access";

export function useMessagesAccess(): { allowed: boolean; loading: boolean } {
  const uid = useSession((s) => s.me?.id);
  const q = useQuery({
    queryKey: ["messages-access", uid],
    queryFn: () => session.myApps().then((r) => r.items),
    enabled: !!uid,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { allowed: canUseMessages(q.data), loading: q.isPending && !!uid };
}
