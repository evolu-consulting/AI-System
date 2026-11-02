// Hồ sơ: trang công ty + bài của họ. Thanh bên đã chuyển sang Shell (CR-110 COM-FR-28); lát cr110-profile-ui dựng lại thành hero + tab.
import type { Profile as ProfileT } from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { initials } from "../lib/format";
import { Composer } from "./Composer";
import { useApp } from "./ctx";
import { FeedList } from "./Feed";

export function ProfilePage() {
  const { api, viewer, route, rev } = useApp();
  const [p, setP] = useState<ProfileT | null>(null);
  const orgId = route.orgId && route.orgId !== viewer.orgId ? route.orgId : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi dữ liệu đổi (rev)
  useEffect(() => {
    api.getProfile(orgId).then(setP, () => setP(null));
  }, [api, orgId, rev]);
  if (!p) return <div className="page" aria-busy="true" />;
  const own = !orgId;
  const sub = p.org.isHost
    ? p.org.blurb
    : [
        p.org.labels
          .map((l) =>
            l === "supplier"
              ? t("community.profile.labelSupplier")
              : t("community.profile.labelBuyer"),
          )
          .join(" · "),
        p.org.area,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div className="ws">
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
              {p.org.left && <span className="tag grey">{t("community.profile.partnerLeft")}</span>}
            </div>
            <div className="hstats">
              <div className="hstat">
                <b>{p.stats.active}</b>
                <span>{t("community.profile.statActive")}</span>
              </div>
              <div className="hstat">
                <b>{p.stats.archived}</b>
                <span>{t("community.profile.statArchived")}</span>
              </div>
              <div className="hstat">
                <b>{p.stats.comments}</b>
                <span>{t("community.profile.statComments")}</span>
              </div>
              {p.stats.friends !== undefined && (
                <div className="hstat">
                  <b>{p.stats.friends}</b>
                  <span>{t("community.profile.statFriends")}</span>
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
