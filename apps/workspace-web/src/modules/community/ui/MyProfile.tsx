// CR-129 L5 · hồ sơ CÁ NHÂN `/community/me`: đầu trang = người (tên, vai), khối phụ «Công ty» (tên, nhãn, link trang công ty);
// tab «Bài đăng của tôi» (feed theo người) và «Bài đăng của tổ chức» (feed theo công ty). Áp cho chủ quản và đối tác.

import type { MyPeopleProfile } from "@ai/contracts/people";
import { PersonAvatar } from "@ai/web-kit/ui/PersonAvatar";
import { useEffect, useState } from "react";
import { useApp } from "../application/ctx";
import { safeCover } from "../domain/brand";
import { initials } from "../domain/format";
import {
  ME_SECTIONS,
  type MeSection,
  meFeedFixed,
  meRoleKey,
  meShowsComposer,
  resolveMeSection,
} from "../domain/me-profile";
import { t } from "../i18n";
import { Composer } from "./Composer";
import { FeedList } from "./Feed";
import { ImagePick } from "./profile/ImagePick";

export function MyProfilePage() {
  const { api, viewer, route, go, href, brand } = useApp();
  const [mine, setMine] = useState<MyPeopleProfile | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.getMyPeople().then(
      (r) => live && setMine(r),
      () => undefined,
    );
    api.getPeople([viewer.userId]).then(
      (r) => live && setDept(r.items[0]?.department?.name ?? null),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, viewer.userId]);
  const save = (kind: "avatar" | "cover") => async (v: string | null) => {
    await api.setMyImage(kind, v);
    setMine((m) => ({ avatar: null, cover: null, job_title: null, ...m, [kind]: v }));
  };
  const cover = safeCover(mine?.cover ?? null);
  const section = resolveMeSection(route.section);
  const open = (s: MeSection) => go({ name: "me", ...(s === "mine" ? {} : { section: s }) });
  const labels = viewer.labels
    .map((l) =>
      t(l === "supplier" ? "community.profile.labelSupplier" : "community.profile.labelBuyer"),
    )
    .join(" · ");
  return (
    <div className="ws">
      <main className="wsmain">
        <div className="wscenter" data-testid="me-page">
          <div className="card">
            <div className="imgedit-host" style={{ position: "relative" }}>
              {cover ? (
                <img
                  src={cover}
                  alt=""
                  data-testid="me-cover"
                  className="cover pcover"
                  style={{ width: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <div className="cover pcover" data-testid="me-cover-default" />
              )}
              <ImagePick
                kind="cover"
                testId="me-cover-edit"
                hasImage={cover !== null}
                onSave={save("cover")}
              />
            </div>
            <div className="phero">
              <div className="imgedit-host imgedit-avatar">
                <PersonAvatar name={viewer.name} src={mine?.avatar} size={72} testId="me-avatar" />
                <ImagePick
                  kind="avatar"
                  testId="me-avatar-edit"
                  hasImage={!!mine?.avatar}
                  onSave={save("avatar")}
                />
              </div>
              <div className="pname">
                <h1>{viewer.name}</h1>
                <div className="sub">{t(meRoleKey(viewer.role))}</div>
                {mine?.job_title && (
                  <div className="sub" data-testid="me-job-title">
                    {t("community.me.jobTitle")}: {mine.job_title}
                  </div>
                )}
                {dept && (
                  <div className="sub" data-testid="me-department">
                    {t("community.me.department")}: {dept}
                  </div>
                )}
                {viewer.email && (
                  <div className="sub" data-testid="me-email">
                    {t("community.me.email")}: {viewer.email}
                  </div>
                )}
              </div>
            </div>
            <div
              className="pcard"
              data-testid="me-company"
              style={{ borderTop: "1px solid var(--rule-soft)" }}
            >
              <h2 style={{ fontSize: 13 }}>{t("community.me.company")}</h2>
              <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {brand.logo ? (
                  <img
                    src={brand.logo}
                    alt=""
                    width={24}
                    height={24}
                    style={{ borderRadius: 6, objectFit: "cover" }}
                  />
                ) : (
                  <span className="av sm">{initials(viewer.orgName)}</span>
                )}
                <b>{viewer.orgName}</b>
                {labels && <span className="muted"> · {labels}</span>}
              </p>
              <a
                href={href({ name: "profile" })}
                onClick={(e) => {
                  e.preventDefault();
                  go({ name: "profile" });
                }}
              >
                {t("community.me.companyPage")}
              </a>
            </div>
            <div className="ptabs tabs" role="tablist" aria-label={t("community.profile.tabsAria")}>
              {ME_SECTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  data-testid={`me-tab-${s}`}
                  aria-selected={section === s}
                  className={section === s ? "tab on" : "tab"}
                  onClick={() => open(s)}
                >
                  {t(`community.me.tabs.${s}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="pbody">
            {meShowsComposer(section) && (
              <div className="pgap">
                <Composer />
              </div>
            )}
            <FeedList
              key={section}
              fixed={meFeedFixed(section, viewer.userId)}
              tabs={["all", "archived"]}
              withFilters={false}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
