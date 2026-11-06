// CR-122 · A2 · FLOW2-FR-12/15/18/19 · luật thuần của 3 sự kiện Community (không I/O): khoá idempotent theo bản ghi, dữ kiện đúng như
// khai ở `community.manifest.ts`, và kết quả Kết thúc (outcome) ⇒ trạng thái bản ghi. Không phụ thuộc kit/db.

export const EV_POST = "post.created";
export const EV_JOIN = "partner.join_requested";
export const EV_REPORT = "report.created";
export const COMMUNITY_EVENTS = [EV_POST, EV_JOIN, EV_REPORT] as const;
export type CommunityEvent = (typeof COMMUNITY_EVENTS)[number];

export type Facts = Record<string, string | boolean | null>;

/** `event_id` ổn định theo bản ghi (một bản ghi ⇒ một sự kiện mỗi loại): ghi lại ⇒ `(tenant_id, event_id)` trùng ⇒ bỏ qua. */
export const eventIdOf = (event: CommunityEvent, ref: string): string => `${event}:${ref}`;

export const postFacts = (p: { type: string; author_org: string | null }): Facts => ({
  post_kind: p.type,
  author_is_partner: p.author_org !== null,
});

/** Tên miền của email (chữ thường); email sai dạng ⇒ null. */
export const emailDomain = (email: string): string | null => {
  const at = email.lastIndexOf("@");
  const d =
    at >= 0
      ? email
          .slice(at + 1)
          .trim()
          .toLowerCase()
      : "";
  return d.includes(".") ? d : null;
};

/** Không đưa email (PII) vào `hub.flow_events.facts`: chỉ tên miền suy ra, đủ cho điều kiện (vd tên miền công ty vs hộp thư miễn phí). */
export const joinFacts = (j: { company: string; email: string }): Facts => ({
  company_name: j.company,
  email_domain: emailDomain(j.email),
});

/** Loại/mức do agent `triage` điền SAU khi tạo báo cáo ⇒ lúc phát sự kiện thường là `null` (node Nếu đọc lại giá trị hiện tại). */
export const reportFacts = (r: {
  triage_kind: string | null;
  triage_level: string | null;
}): Facts => ({ report_kind: r.triage_kind, severity: r.triage_level });

/** Hiện bài ⇒ approved; Ẩn bài ⇒ rejected. Khoá lạ ⇒ null (handler ném, engine thử lại/Cần xử lý). */
export function postTarget(outcome: string): "approved" | "rejected" | null {
  return outcome === "shown" ? "approved" : outcome === "hidden" ? "rejected" : null;
}

/** Nhận ⇒ approved (+ liên kết đối tác); Từ chối ⇒ rejected. */
export function joinTarget(outcome: string): "approved" | "rejected" | null {
  return outcome === "accepted" ? "approved" : outcome === "rejected" ? "rejected" : null;
}

/** Ẩn ⇒ hide (ẩn bài); Giữ ⇒ dismiss; Cảnh báo ⇒ warn. */
export function reportTarget(outcome: string): "hide" | "dismiss" | "warn" | null {
  return outcome === "hidden"
    ? "hide"
    : outcome === "kept"
      ? "dismiss"
      : outcome === "warned"
        ? "warn"
        : null;
}
