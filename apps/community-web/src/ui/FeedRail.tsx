// Cột phải bảng tin (role-aware, Phase A — chỉ dữ liệu sẵn có): bộ lọc, Đối tác trong chợ (chủ quản) / Công ty của bạn + Mẹo đăng bài (đối tác).
import type { PartnerOrg } from "@ai/contracts/community";
import type { ReactNode } from "react";
import { initials, tone } from "../lib/format";
import { hashOf, useApp } from "./ctx";
import { IconExternal, IconFilter, IconUsers } from "./icons";

const meta = (p: PartnerOrg) => [p.cats[0], p.area].filter(Boolean).join(" · ");

function OrgRow({ p }: { p: PartnerOrg }) {
  return (
    <a
      className="rrow"
      data-testid="rail-org"
      href={hashOf({ name: "profile", orgId: p.id })}
      target="_blank"
      rel="noopener"
    >
      <span className={`ra av ${tone(p.id, false)}`}>{initials(p.name)}</span>
      <span className="rt">
        <b>{p.name}</b>
        {meta(p) && <span>{meta(p)}</span>}
      </span>
      {p.left && <span className="tag grey sm">đã rời</span>}
      <span className="rext" aria-hidden="true">
        <IconExternal size={14} />
      </span>
    </a>
  );
}

const TIPS = [
  "Ghi rõ giá hoặc ngân sách để đối tác phản hồi nhanh hơn.",
  "Thêm số lượng và khu vực giao nhận ngay trong bài.",
  "Đính kèm ảnh thật của hàng để tăng độ tin cậy.",
];

export function FeedRail({ filters, partners }: { filters: ReactNode; partners: PartnerOrg[] }) {
  const { isHostViewer } = useApp();
  return (
    <aside className="rail" aria-label="Cột phụ bảng tin">
      {filters && (
        <section className="rcard">
          <h2>
            <IconFilter size={15} />
            Bộ lọc
          </h2>
          {filters}
        </section>
      )}
      {isHostViewer && partners.length > 0 && (
        <section className="rcard" data-testid="rail-partners">
          <h2>
            <IconUsers size={15} />
            Đối tác
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
                Công ty của bạn
              </h2>
              <div className="rlist">
                {partners.map((p) => (
                  <OrgRow key={p.id} p={p} />
                ))}
              </div>
            </section>
          )}
          <section className="rcard">
            <h2>Mẹo đăng bài</h2>
            <ul className="rtips">
              {TIPS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </aside>
  );
}
