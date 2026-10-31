// Hồ sơ (mockup profile): thanh bên "Sổ Hợp Tác" (chủ quản, mở sang contracts-web) + "Community", trang công ty + bài của họ.
import type { PartnerOrg, Profile as ProfileT } from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { initials } from "../lib/format";
import { Composer } from "./Composer";
import { useApp } from "./ctx";
import { FeedList } from "./Feed";
import { IconBook, IconEdit, IconGear } from "./icons";

export function ProfilePage() {
  const { api, viewer, route, go, rev, isHostViewer } = useApp();
  const [p, setP] = useState<ProfileT | null>(null);
  const [partners, setPartners] = useState<PartnerOrg[]>([]);
  const orgId = route.orgId && route.orgId !== viewer.orgId ? route.orgId : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi dữ liệu đổi (rev)
  useEffect(() => {
    api.getProfile(orgId).then(setP, () => setP(null));
  }, [api, orgId, rev]);
  useEffect(() => {
    if (isHostViewer) api.listPartners().then(setPartners, () => undefined);
  }, [api, isHostViewer]);
  if (!p) return <div className="page" aria-busy="true" />;
  const own = !orgId;
  const sub = p.org.isHost
    ? p.org.blurb
    : [
        p.org.labels.map((l) => (l === "supplier" ? "Nhà cung cấp" : "Người mua")).join(" · "),
        p.org.area,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div className="ws">
      <nav className="wsside" aria-label="Hồ sơ và Sổ Hợp Tác">
        <div className="mini">
          <span className="av lg t1">{initials(viewer.orgName)}</span>
          <div>
            <b>{viewer.orgName}</b>
            <span>
              {viewer.name} ·{" "}
              {isHostViewer ? (viewer.role === "host_admin" ? "Admin" : "Thành viên") : "Đối tác"}
            </span>
          </div>
        </div>
        {isHostViewer && (
          <div className="sidegroup">
            <div className="sidecap">Sổ Hợp Tác</div>
            <a
              className="sidelink"
              href={p.shtUrl ?? "/contracts"}
              data-testid="sht-link"
              style={{ textDecoration: "none" }}
            >
              <IconBook />
              Mở Sổ Hợp Tác
            </a>
          </div>
        )}
        <div className="sidegroup">
          <div className="sidecap">Community</div>
          <button
            type="button"
            className={own ? "sidelink on" : "sidelink"}
            onClick={() => go({ name: "profile" })}
          >
            <IconEdit />
            Bài đăng của tôi
          </button>
        </div>
        {isHostViewer && partners.length > 0 && (
          <div className="sidegroup">
            <div className="sidecap">Đối tác</div>
            {partners.map((o) => (
              <button
                key={o.id}
                type="button"
                className={o.id === orgId ? "sidelink on" : "sidelink"}
                onClick={() => go({ name: "profile", orgId: o.id })}
              >
                {o.name}
              </button>
            ))}
          </div>
        )}
        <div className="sidegroup bottom">
          <button type="button" className="sidelink" onClick={() => go({ name: "settings" })}>
            <IconGear />
            Cài đặt
          </button>
        </div>
      </nav>
      <main className="wsmain">
        <div className="wscenter">
          <div className="card">
            <div className="cover" style={{ height: 90 }} />
            <div className="phero">
              <span className="biglogo">{initials(p.org.name)}</span>
              <div style={{ flex: 1, minWidth: 220, paddingBottom: 4 }}>
                <h1>{p.org.name}</h1>
                <div className="sub">{sub}</div>
              </div>
              {p.org.left && <span className="tag grey">đối tác đã rời</span>}
            </div>
            <div className="hstats">
              <div className="hstat">
                <b>{p.stats.active}</b>
                <span>Bài đang đăng</span>
              </div>
              <div className="hstat">
                <b>{p.stats.archived}</b>
                <span>Đã lưu trữ</span>
              </div>
              <div className="hstat">
                <b>{p.stats.comments}</b>
                <span>Bình luận nhận được</span>
              </div>
              {p.stats.friends !== undefined && (
                <div className="hstat">
                  <b>{p.stats.friends}</b>
                  <span>Bạn bè</span>
                </div>
              )}
            </div>
          </div>
          {own && (
            <div style={{ marginTop: 16 }}>
              <Composer />
            </div>
          )}
          <FeedList
            fixed={own ? { mine: true } : { authorOrgId: orgId }}
            tabs={["all", "archived"]}
            withFilters={false}
          />
        </div>
      </main>
    </div>
  );
}
