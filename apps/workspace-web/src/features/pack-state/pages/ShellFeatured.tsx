// CR-118 · cr118-feature-gate-web · Shell trong vùng cờ tính năng (OpenFeature). Chunk riêng, nạp sau khi cờ về.
// CR-120: quyền ghi/chủ sở hữu (`/pack/contracts/me`) chỉ nạp khi gói contracts bật (đối tác không gọi); bản dựng mock Community không có
// phiên ⇒ người dùng/gói lấy từ "nhân vật" của adapter mock (shell/dev-identity).

import { useSession } from "~/features/auth/hooks/use-session";
import { Shell } from "~/features/shell/pages/Shell";
import { FeatureRoot } from "~/platform/features";
import { useDevIdentity } from "~/shell/dev-identity";
import { useShellPacks } from "~/shell/use-shell-packs";
import { useMe } from "../hooks/use-me";

function ShellWithMe() {
  const user = useSession((s) => s.me);
  const dev = useDevIdentity();
  const packs = useShellPacks();
  const me = useMe({ enabled: packs.contracts === true });
  return <Shell user={dev?.user ?? user} write={me.write} owner={me.owner} />;
}

export default function ShellFeatured() {
  return (
    <FeatureRoot>
      <ShellWithMe />
    </FeatureRoot>
  );
}
