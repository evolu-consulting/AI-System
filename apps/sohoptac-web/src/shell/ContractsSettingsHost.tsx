// CR-118 · hộp thoại Cài đặt Sổ Hợp Tác dùng chung (features/settings) gắn vào layout Community: mục "Sổ Hợp Tác" trong Cài đặt
// Community mở nó tại chỗ (bus `openSettings`), không đổi URL. Chỉ dựng khi /pack/me bật contracts; chạy lười (chunk riêng).
import { useMe } from "~/features/pack-state/hooks/use-me";
import { SettingsDialogLazy } from "~/features/settings/components/SettingsDialogLazy";

export function ContractsSettingsHost() {
  const me = useMe();
  return <SettingsDialogLazy owner={me.owner} tenantName={me.user?.tenant.name ?? ""} />;
}
