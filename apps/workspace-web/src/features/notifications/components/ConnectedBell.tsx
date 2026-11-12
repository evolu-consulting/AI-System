// N3-FR-09 · nối chuông S16 (shell) với dữ liệu thật; chỉ gọi khi đã có phiên (Header chỉ render trong Shell đã đăng nhập).
import { NotificationBell } from "~/features/shell/components/NotificationBell";
import { useShellPacks } from "~/shell/use-shell-packs";
import { useBell } from "../hooks/use-notifications";

export function ConnectedBell() {
  const bell = useBell();
  const packs = useShellPacks();
  return (
    <NotificationBell
      unread={bell.unread}
      items={bell.items}
      onOpen={bell.refresh}
      onRead={bell.readOne}
      onReadAll={bell.readAll}
      showFooter={packs.contracts === true}
    />
  );
}
