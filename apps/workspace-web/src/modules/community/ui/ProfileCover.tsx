// CR-138 Q9 · ảnh bìa CÔNG TY ở đầu hồ sơ công ty chủ quản (đối tác xem hồ sơ công ty cũng thấy). Chưa có ảnh ⇒ nền màu chủ đạo.
// Chỉ hồ sơ của công ty chủ quản (`isHost`); hồ sơ công ty đối tác giữ nền nhạt mặc định.
import { useEffect, useState } from "react";
import { useApp } from "../application/ctx";
import { safeCover } from "../domain/brand";
import { t } from "../i18n";

export function ProfileCover({ isHost }: { isHost: boolean }) {
  const { api } = useApp();
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    if (!isHost) return;
    let live = true;
    api.getBrandCover().then(
      (r) => live && setCover(safeCover(r.cover)),
      () => live && setCover(null),
    );
    return () => {
      live = false;
    };
  }, [api, isHost]);
  if (!isHost) return <div className="cover pcover" />;
  return cover ? (
    <img
      src={cover}
      alt={t("community.profile.coverAlt")}
      data-testid="company-cover"
      className="cover pcover"
      style={{ width: "100%", objectFit: "cover", display: "block" }}
    />
  ) : (
    <div
      className="cover pcover"
      data-testid="company-cover-default"
      style={{
        background: "linear-gradient(135deg, var(--cm-accent), var(--grad-to, var(--cm-accent)))",
      }}
    />
  );
}
