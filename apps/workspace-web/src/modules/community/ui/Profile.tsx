// CR-110 · COM-FR-35..37 · hồ sơ kiểu Facebook: hero + số liệu + hàng tab theo registry (lib/profile-sections).
// Chủ quản 4 tab; đối tác 3 tab (không render tab Đối tác, không hstat Bạn bè). `#/profile/<orgId>/<section>`.
import type { Profile as ProfileT } from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { useApp } from "../application/ctx";
import { initials } from "../domain/format";
import {
  friendsStat,
  resolveSection,
  type SectionId,
  visibleSections,
} from "../domain/profile-sections";
import { t } from "../i18n";
import { ProfileCover } from "./ProfileCover";
import { AboutSection, MediaSection, PartnersSection, PostsSection } from "./profile/sections";

export function ProfilePage() {
  const { api, viewer, route, rev, isHostViewer, go } = useApp();
  const [p, setP] = useState<ProfileT | null>(null);
  const orgId = route.orgId && route.orgId !== viewer.orgId ? route.orgId : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi dữ liệu đổi (rev)
  useEffect(() => {
    api.getProfile(orgId).then(setP, () => setP(null));
  }, [api, orgId, rev]);
  if (!p) return <div className="page" aria-busy="true" />;
  const own = !orgId;
  const targetId = orgId ?? viewer.orgId;
  const ctx = { isHostViewer };
  const section = resolveSection(route.section, ctx);
  const friends = friendsStat(p.stats.friends, ctx);
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
  const open = (id: SectionId) => go({ name: "profile", orgId: targetId, section: id });

  return (
    <div className="ws">
      <main className="wsmain">
        <div className="wscenter" data-testid="profile-page">
          <div className="card">
            <ProfileCover isHost={p.org.isHost} />
            <div className="phero">
              <span className="biglogo">{initials(p.org.name)}</span>
              <div className="pname">
                <h1>{p.org.name}</h1>
                <div className="sub">{sub}</div>
              </div>
              {p.org.left && <span className="tag grey">{t("community.profile.partnerLeft")}</span>}
            </div>
            <div className="hstats">
              <Stat n={p.stats.active} label={t("community.profile.statActive")} />
              <Stat n={p.stats.archived} label={t("community.profile.statArchived")} />
              <Stat n={p.stats.comments} label={t("community.profile.statComments")} />
              {friends !== undefined && (
                <Stat n={friends} label={t("community.profile.statFriends")} id="friends" />
              )}
            </div>
            <div className="ptabs tabs" role="tablist" aria-label={t("community.profile.tabsAria")}>
              {visibleSections(ctx).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  data-testid={`profile-tab-${s.id}`}
                  aria-selected={section === s.id}
                  className={section === s.id ? "tab on" : "tab"}
                  onClick={() => open(s.id)}
                >
                  {t(s.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div className="pbody">
            {section === "about" && <AboutSection p={p} />}
            {section === "posts" && <PostsSection own={own} orgId={targetId} />}
            {section === "partners" && isHostViewer && <PartnersSection />}
            {section === "files" && <MediaSection orgId={targetId} />}
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({ n, label, id }: { n: number; label: string; id?: string }) {
  return (
    <div className="hstat" data-testid={id ? `hstat-${id}` : undefined}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}
