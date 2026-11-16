// CR-129 L5 · hồ sơ CÁ NHÂN `/community/me`: đầu trang = người (tên, vai, công ty, email — xem MyProfileHeader);
// tab «Bài đăng của tôi» (feed theo người) và «Bài đăng của tổ chức» (feed theo công ty). Áp cho chủ quản và đối tác.

import type { MyPeopleProfile } from "@ai/contracts/people";
import { useEffect, useState } from "react";
import { useApp } from "../application/ctx";
import {
  ME_SECTIONS,
  type MeSection,
  meFeedFixed,
  meShowsComposer,
  resolveMeSection,
} from "../domain/me-profile";
import { t } from "../i18n";
import { Composer } from "./Composer";
import { FeedList } from "./Feed";
import { MyProfileHeader } from "./MyProfileHeader";

export function MyProfilePage() {
  const { api, viewer, route, go } = useApp();
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
  const section = resolveMeSection(route.section);
  const open = (s: MeSection) => go({ name: "me", ...(s === "mine" ? {} : { section: s }) });
  return (
    <div className="ws">
      <main className="wsmain">
        <div className="wscenter" data-testid="me-page">
          <div className="card">
            <MyProfileHeader mine={mine} dept={dept} onSave={save} />
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
