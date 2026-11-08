// CR-110 · COM-FR-36/37 · nội dung 4 mục hồ sơ. Mỗi mục là component riêng; `ProfilePage` chỉ ghép theo registry.
import type {
  ModerationItem,
  PartnerOrg,
  Profile,
  ProfileMediaItem,
} from "@ai/contracts/community";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../application/ctx";
import { byPostId, hasOpenModeration } from "../../domain/flows";
import { hasReputation } from "../../domain/profile-sections";
import { t } from "../../i18n";
import { Composer } from "../Composer";
import { FeedList } from "../Feed";

const labelText = (l: string): string =>
  l === "supplier" ? t("community.profile.labelSupplier") : t("community.profile.labelBuyer");

/** Giới thiệu: chỉ đọc (không có hợp đồng/hoa hồng); thẻ "Hoạt động" chỉ số bài, không câu về Sổ Hợp Tác. */
export function AboutSection({ p }: { p: Profile }) {
  const rows: [string, string][] = [
    [t("community.profile.about.area"), p.org.area ?? ""],
    [t("community.profile.about.labels"), p.org.labels.map(labelText).join(" · ")],
    [t("community.profile.about.cats"), p.org.cats.join(", ")],
  ];
  const known = rows.filter(([, v]) => v);
  return (
    <div className="pgrid">
      <section className="card pcard">
        <h2>{t("community.profile.about.intro")}</h2>
        {p.org.blurb && <p>{p.org.blurb}</p>}
        {known.length === 0 && !p.org.blurb && (
          <p className="muted">{t("community.profile.about.empty")}</p>
        )}
        <dl className="pdl">
          {known.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card pcard">
        <h2>{t("community.profile.about.activity")}</h2>
        <p>
          {t("community.profile.about.activityLine", {
            active: p.stats.active,
            archived: p.stats.archived,
            comments: p.stats.comments,
          })}
        </p>
      </section>
    </div>
  );
}

/** Bài đăng: Composer chỉ ở hồ sơ của mình. */
export function PostsSection({ own, orgId }: { own: boolean; orgId: string }) {
  const { api, rev } = useApp();
  const [mods, setMods] = useState<ReadonlyMap<string, ModerationItem> | undefined>();
  // CR-120: trạng thái duyệt của bài tôi = MỘT yêu cầu cho cả danh sách (không gọi theo bài). Lỗi/khe tắt ⇒ không hiện gì.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi dữ liệu đổi (rev)
  useEffect(() => {
    if (!own) return;
    api.flows.myModeration().then(
      (r) => setMods(byPostId(r.items)),
      () => setMods(undefined),
    );
  }, [api, own, rev]);
  // UX-S5 · còn bài chờ duyệt ⇒ nạp lại mỗi 15 giây để tác giả thấy "Đã đăng" / "Đã ẩn — lý do" mà không phải tải lại trang
  const open = hasOpenModeration(mods);
  useEffect(() => {
    if (!own || !open) return;
    const id = setInterval(() => {
      api.flows.myModeration().then(
        (r) => setMods(byPostId(r.items)),
        () => undefined,
      );
    }, 15_000);
    return () => clearInterval(id);
  }, [api, own, open]);
  return (
    <>
      {own && (
        <div className="pgap">
          <Composer />
        </div>
      )}
      <FeedList
        fixed={own ? { mine: true } : { authorOrgId: orgId }}
        tabs={["all", "archived"]}
        withFilters={false}
        {...(mods ? { mods } : {})}
      />
    </>
  );
}

/** Đối tác (chỉ chủ quản; đối tác không bao giờ render mục này). Cột uy tín chỉ khi server trả `reputation`. */
export function PartnersSection() {
  const { api, rev } = useApp();
  const [list, setList] = useState<PartnerOrg[] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi dữ liệu đổi (rev)
  useEffect(() => {
    api.listPartners({ rep: true }).then(setList, () => setList([]));
  }, [api, rev]);
  if (!list) return <div className="card pcard" aria-busy="true" />;
  if (list.length === 0)
    return <div className="card empty">{t("community.profile.partners.empty")}</div>;
  const rep = hasReputation(list);
  return (
    <div className="card ptable-wrap">
      <table className="ptable" data-testid="profile-partners">
        <thead>
          <tr>
            <th>{t("community.profile.partners.colName")}</th>
            <th>{t("community.profile.partners.colLabels")}</th>
            <th>{t("community.profile.partners.colCats")}</th>
            {rep && <th>{t("community.profile.partners.colRep")}</th>}
          </tr>
        </thead>
        <tbody>
          {list.map((o) => (
            <tr key={o.id}>
              <td>
                <a href={`#/profile/${encodeURIComponent(o.id)}`}>{o.name}</a>
                {o.left && (
                  <span className="tag grey sm">{t("community.profile.partners.left")}</span>
                )}
              </td>
              <td>{o.labels.map(labelText).join(" · ")}</td>
              <td>{o.cats.join(", ")}</td>
              {rep && (
                <td data-testid="partner-rep">
                  {o.reputation?.band
                    ? t(`community.profile.rep.${o.reputation.band}`)
                    : t("community.profile.rep.none")}
                  {o.reputation?.score != null && ` (${o.reputation.score})`}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ảnh & tệp: lưới từ API media, "Xem thêm" theo con trỏ, trạng thái rỗng. */
export function MediaSection({ orgId }: { orgId: string }) {
  const { api, rev } = useApp();
  const [items, setItems] = useState<ProfileMediaItem[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const load = useCallback(
    async (cursor?: string) => {
      try {
        const r = await api.getProfileMedia(orgId, cursor ? { cursor } : {});
        setItems((cur) => (cursor ? [...cur, ...r.items] : r.items));
        setNext(r.nextCursor);
        setState("ok");
      } catch {
        setState("error");
      }
    },
    [api, orgId],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi dữ liệu đổi (rev)
  useEffect(() => {
    setState("loading");
    load();
  }, [load, rev]);
  if (state === "loading") return <div className="card pcard" aria-busy="true" />;
  if (state === "error")
    return <div className="card empty">{t("community.profile.files.error")}</div>;
  if (items.length === 0)
    return <div className="card empty">{t("community.profile.files.empty")}</div>;
  return (
    <div className="card pcard">
      <ul className="mgrid" data-testid="profile-media">
        {items.map((m) => (
          <li key={m.id} className={`mcell ${m.kind}`}>
            <span className="mkind">
              {m.kind === "image"
                ? t("community.profile.files.image")
                : t("community.profile.files.video")}
            </span>
            {m.url ? (
              <a href={m.url} target="_blank" rel="noreferrer">
                {m.label}
              </a>
            ) : (
              <span>{m.label}</span>
            )}
          </li>
        ))}
      </ul>
      {next && (
        <button type="button" className="btn" onClick={() => load(next)}>
          {t("community.profile.files.more")}
        </button>
      )}
    </div>
  );
}
