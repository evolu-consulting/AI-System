// CR-129 L5 · hồ sơ CÁ NHÂN `/community/me`: đầu trang = người (tên, vai), khối phụ «Công ty» (tên, nhãn, link trang công ty);
// tab «Bài đăng của tôi» (feed theo người) và «Bài đăng của tổ chức» (feed theo công ty). Áp cho chủ quản và đối tác.
import { useApp } from "../application/ctx";
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

export function MyProfilePage() {
  const { viewer, route, go, href, brand } = useApp();
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
            <div className="cover pcover" />
            <div className="phero">
              <span className="biglogo">{initials(viewer.name)}</span>
              <div className="pname">
                <h1>{viewer.name}</h1>
                <div className="sub">{t(meRoleKey(viewer.role))}</div>
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
