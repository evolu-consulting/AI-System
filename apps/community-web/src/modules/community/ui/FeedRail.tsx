// Cột phải bảng tin (role-aware, Phase A — chỉ dữ liệu sẵn có): bộ lọc, Đối tác trong chợ (chủ quản) / Công ty của bạn + Mẹo đăng bài (đối tác).
import type { PartnerOrg } from "@ai/contracts/community";
import type { ReactNode } from "react";
import { useApp } from "../application/ctx";
import { initials, tone } from "../domain/format";
import { t } from "../i18n";
import { IconExternal, IconFilter, IconUsers } from "./icons";

const meta = (p: PartnerOrg) => [p.cats[0], p.area].filter(Boolean).join(" · ");

function OrgRow({ p }: { p: PartnerOrg }) {
  const { href } = useApp();
  return (
    <a
      className="rrow"
      data-testid="rail-org"
      href={href({ name: "profile", orgId: p.id })}
      target="_blank"
      rel="noopener"
    >
      <span className={`ra av ${tone(p.id, false)}`}>{initials(p.name)}</span>
      <span className="rt">
        <b>{p.name}</b>
        {meta(p) && <span>{meta(p)}</span>}
      </span>
      {p.left && <span className="tag grey sm">{t("community.feed.rail.left")}</span>}
      <span className="rext" aria-hidden="true">
        <IconExternal size={14} />
      </span>
    </a>
  );
}

const TIPS = ["tip1", "tip2", "tip3"] as const;

export function FeedRail({ filters, partners }: { filters: ReactNode; partners: PartnerOrg[] }) {
  const { isHostViewer } = useApp();
  return (
    <aside className="rail" aria-label={t("community.feed.rail.aria")}>
      {filters && (
        <section className="rcard">
          <h2>
            <IconFilter size={15} />
            {t("community.feed.rail.filters")}
          </h2>
          {filters}
        </section>
      )}
      {isHostViewer && partners.length > 0 && (
        <section className="rcard" data-testid="rail-partners">
          <h2>
            <IconUsers size={15} />
            {t("community.feed.rail.partners")}
          </h2>
          <div className="rlist">
            {partners.map((p) => (
              <OrgRow key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}
      {!isHostViewer && (
        <>
          {partners.length > 0 && (
            <section className="rcard" data-testid="rail-mine">
              <h2>
                <IconUsers size={15} />
                {t("community.feed.rail.yourCompany")}
              </h2>
              <div className="rlist">
                {partners.map((p) => (
                  <OrgRow key={p.id} p={p} />
                ))}
              </div>
            </section>
          )}
          <section className="rcard">
            <h2>{t("community.feed.rail.tipsTitle")}</h2>
            <ul className="rtips">
              {TIPS.map((k) => (
                <li key={k}>{t(`community.feed.rail.${k}`)}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </aside>
  );
}
