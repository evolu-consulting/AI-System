// Cài đặt (mockup settings): Tài khoản, Giao diện (màu chủ đạo: Chàm, Xanh dương, Xanh ngọc, Xanh lá, Cam), Thông báo (bật/tắt từng loại).
import {
  COMMUNITY_ACCENTS,
  type CommunityAccent,
  type CommunitySettings,
  DEFAULT_SETTINGS,
  NOTIFY_KINDS,
  type NotifyKind,
} from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { initials } from "../lib/format";
import { useApp } from "./ctx";

export const ACCENT_META: Record<CommunityAccent, { label: string; color: string }> = {
  indigo: { label: "Chàm", color: "#4f46e5" },
  blue: { label: "Xanh dương", color: "#2563eb" },
  teal: { label: "Xanh ngọc", color: "#0891b2" },
  green: { label: "Xanh lá", color: "#16a34a" },
  orange: { label: "Cam", color: "#ea580c" },
};
const NOTIFY_TEXT: Record<NotifyKind, [string, string]> = {
  comment: ["Có người bình luận bài của tôi", "Thông báo ngay khi có bình luận mới."],
  reply: ["Có người trả lời bình luận của tôi", "Theo dõi các cuộc trao đổi đang diễn ra."],
  newSell: ["Nhà cung cấp đăng bài Cần bán mới", "Chỉ chủ quản."],
  newBuy: ["Người mua đăng bài Cần mua mới", "Chỉ chủ quản."],
  matchBuy: ["Bài Cần mua khớp hàng đang có", "Chỉ chủ quản."],
  priceEdited: ["Nhà cung cấp sửa giá bài đã lưu", "Chỉ chủ quản."],
  expiring: ["Bài sắp tự hết hạn (3 ngày)", "Hỏi gia hạn hay lưu trữ."],
  digest: ["Tổng hợp hằng ngày 8:00", "Bài mới, Cần bán chưa lưu."],
};
const HOST_ONLY: NotifyKind[] = ["newSell", "newBuy", "matchBuy", "priceEdited", "digest"];
type Tab = "account" | "look" | "notify";

export function SettingsPage() {
  const { api, viewer, isHostViewer, accent, setAccent, toast } = useApp();
  const [tab, setTab] = useState<Tab>("account");
  const [s, setS] = useState<CommunitySettings>({ ...DEFAULT_SETTINGS, accent });
  useEffect(() => {
    api.getSettings().then(
      (r) => setS({ ...r, accent }),
      () => undefined,
    );
  }, [api, accent]);
  const save = async (next: CommunitySettings) => {
    setS(next);
    await api.saveSettings(next);
    toast("Đã lưu cài đặt");
  };
  const kinds = NOTIFY_KINDS.filter((k) => isHostViewer || !HOST_ONLY.includes(k));
  const items: [Tab, string][] = [
    ["account", "Tài khoản"],
    ["look", "Giao diện"],
    ["notify", "Thông báo"],
  ];
  return (
    <div className="ws">
      <nav className="wsside" aria-label="Mục cài đặt">
        <div className="mini">
          <span className="av lg t7">{initials(viewer.name)}</span>
          <div>
            <b>Cài đặt</b>
            <span>{viewer.name}</span>
          </div>
        </div>
        <div className="sidegroup">
          {items.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "sidelink on" : "sidelink"}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      <main className="wsmain">
        <section className="card setbody">
          {tab === "account" && (
            <>
              <h2>Tài khoản</h2>
              <p className="lead">Thông tin đăng nhập của bạn trong {viewer.orgName}.</p>
              <div className="form">
                <div>
                  <label htmlFor="s-name">Họ tên</label>
                  <input id="s-name" className="field" value={viewer.name} readOnly />
                </div>
                <div>
                  <label htmlFor="s-org">Công ty</label>
                  <input id="s-org" className="field" value={viewer.orgName} readOnly />
                </div>
              </div>
            </>
          )}
          {tab === "look" && (
            <>
              <h2>Giao diện</h2>
              <p className="lead">Chọn màu chủ đạo của ứng dụng.</p>
              <span className="flabel">Màu chủ đạo</span>
              <fieldset className="swatches" aria-label="Màu chủ đạo">
                {COMMUNITY_ACCENTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={accent === a ? "swatch on" : "swatch"}
                    style={{ background: ACCENT_META[a].color }}
                    aria-label={ACCENT_META[a].label}
                    aria-pressed={accent === a}
                    onClick={() => {
                      setAccent(a);
                      save({ ...s, accent: a });
                    }}
                  />
                ))}
              </fieldset>
            </>
          )}
          {tab === "notify" && (
            <>
              <h2>Thông báo</h2>
              <p className="lead">Chọn khi nào bạn muốn nhận thông báo (chỉ trong ứng dụng).</p>
              {kinds.map((k) => (
                <div className="row" key={k}>
                  <div className="t">
                    <b>{NOTIFY_TEXT[k][0]}</b>
                    <span>{NOTIFY_TEXT[k][1]}</span>
                  </div>
                  <button
                    type="button"
                    className="sw"
                    aria-pressed={s.notify[k]}
                    aria-label={NOTIFY_TEXT[k][0]}
                    onClick={() => save({ ...s, notify: { ...s.notify, [k]: !s.notify[k] } })}
                  />
                </div>
              ))}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
