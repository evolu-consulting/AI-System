// V2-I · chọn vai trên trang chi tiết (đối tác nhiều vai): liên kết đổi `?role=` — giữ tab và khoảng biểu đồ.
import type { RepRole } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { Range, Tab } from "../lib/partner-v2";
import { SEG, segItem } from "./seg-style";

export function RoleSeg({
  party,
  roles,
  role,
  tab,
  range,
}: {
  party: string;
  roles: readonly RepRole[];
  role: RepRole;
  tab?: Tab;
  range?: Range;
}) {
  const { t } = useTranslation();
  if (roles.length < 2) return null;
  return (
    <span role="tablist" aria-label={t("contracts.pv2.roleSeg")} className={SEG}>
      {roles.map((r) => (
        <Link
          key={r}
          to="/partners"
          search={{
            party,
            role: r,
            ...(tab && tab !== "overview" ? { tab } : {}),
            ...(range && range !== 12 ? { range } : {}),
          }}
          role="tab"
          aria-selected={r === role}
          className={segItem(r === role)}
        >
          {t(`contracts.pv2.roleWord.${r}`)}
        </Link>
      ))}
    </span>
  );
}
