// COM-FR-28/29 · Sidebar cố định của Shell: nhóm Community (Bảng tin, Bài đăng của tôi) + nhóm Sổ Hợp Tác (link ngoài sang contracts-web).
// Nhóm Sổ Hợp Tác chỉ nằm trong mô hình nav khi `caps.contracts` (lib/nav.ts) ⇒ đối tác / chủ quản thiếu quyền: KHÔNG có trong DOM
// (không phải CSS ẩn — I1/I3, HT-75/76). ≤ 900 px thành drawer (Shell giữ `open`). Xổ/gập nhớ trong localStorage.
import { type MouseEvent, useMemo, useState } from "react";
import { t } from "../i18n";
import { openContracts } from "../lib/contracts-link";
import {
  buildNav,
  contractsHref,
  isActive,
  type NavGroup,
  type NavIcon,
  type NavItem,
} from "../lib/nav";
import { hashOf } from "../lib/route";
import { loadCollapsed, saveCollapsed, toggleCollapsed } from "../lib/sidebar-state";
import { useApp } from "./ctx";
import {
  IconBox,
  IconChevron,
  IconDashboard,
  IconDoc,
  IconEdit,
  IconExternal,
  IconHome,
  IconUsers,
} from "./icons";

const ICONS: Record<NavIcon, () => JSX.Element> = {
  home: () => <IconHome size={17} />,
  edit: () => <IconEdit size={17} />,
  dashboard: () => <IconDashboard size={17} />,
  doc: () => <IconDoc size={17} />,
  users: () => <IconUsers size={17} />,
  box: () => <IconBox size={17} />,
};

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { viewer, route } = useApp();
  const Icon = ICONS[item.icon];
  const target = item.target;
  if (target.kind === "contracts") {
    // Chỉ tới được khi nhóm SHT có trong mô hình ⇒ `contractsUrl` khác null.
    const base = viewer.contractsUrl ?? "/";
    const go = (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      void openContracts(target.path, base, { allowed: viewer.caps.contracts });
    };
    return (
      <a
        className="sidelink"
        href={contractsHref(base, target.path)}
        data-testid="sht-link"
        onClick={go}
      >
        <Icon />
        {t(item.labelKey)}
        <span className="ext">
          <IconExternal size={13} />
        </span>
      </a>
    );
  }
  const on = isActive(item, route, viewer.orgId);
  return (
    <a
      className={on ? "sidelink on" : "sidelink"}
      href={hashOf(target.route)}
      aria-current={on ? "page" : undefined}
      onClick={onNavigate}
    >
      <Icon />
      {t(item.labelKey)}
    </a>
  );
}

function Group({
  group,
  collapsed,
  onToggle,
  onNavigate,
}: {
  group: NavGroup;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const id = `nav-${group.id}`;
  return (
    <div className={collapsed ? "grp collapsed" : "grp"} data-testid={`nav-group-${group.id}`}>
      <button
        type="button"
        className="gh"
        aria-expanded={!collapsed}
        aria-controls={id}
        onClick={onToggle}
      >
        {t(group.labelKey)}
        <span className="chev">
          <IconChevron />
        </span>
      </button>
      <div id={id} className="items" hidden={collapsed}>
        {group.items.map((it) => (
          <NavLink key={it.id} item={it} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { viewer } = useApp();
  const { orgId, caps, contractsUrl } = viewer;
  const groups = useMemo(
    () => buildNav({ ownOrgId: orgId, caps, contractsUrl }),
    [orgId, caps, contractsUrl],
  );
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = toggleCollapsed(c, id);
      saveCollapsed(next);
      return next;
    });
  return (
    <>
      {open && (
        <button
          type="button"
          className="scrim"
          aria-label={t("community.nav.close")}
          onClick={onClose}
        />
      )}
      <aside id="shell-nav" className={open ? "side open" : "side"}>
        <nav aria-label={t("community.nav.label")}>
          {groups.map((g) => (
            <Group
              key={g.id}
              group={g}
              collapsed={collapsed.includes(g.id)}
              onToggle={() => toggle(g.id)}
              onNavigate={onClose}
            />
          ))}
        </nav>
      </aside>
    </>
  );
}
