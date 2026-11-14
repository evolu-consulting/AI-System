// CR-138 Q9 · ảnh bìa CÔNG ty ở đầu hồ sơ công ty chủ quản (đối tác xem hồ sơ công ty cũng thấy). Chưa có ảnh ⇒ nền màu chủ đạo.
// CR-147b · chủ sở hữu (`viewer.caps.companyAdmin`) có nút «Đổi ảnh bìa» ngay tại đây — cùng nguồn `company_settings.cover`.
// Chỉ hồ sơ của công ty chủ quản (`isHost`); hồ sơ công ty đối tác giữ nền nhạt mặc định.
import { useEffect, useState } from "react";
import { useApp } from "../application/ctx";
import { safeCover } from "../domain/brand";
import { t } from "../i18n";
import { ImagePick } from "./profile/ImagePick";

export function ProfileCover({ isHost, canEdit = false }: { isHost: boolean; canEdit?: boolean }) {
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
  return (
    <div style={{ position: "relative" }}>
      {cover ? (
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
            background:
              "linear-gradient(135deg, var(--cm-accent), var(--grad-to, var(--cm-accent)))",
          }}
        />
      )}
      {canEdit && (
        <div style={{ position: "absolute", right: 12, bottom: 12 }}>
          <ImagePick
            kind="cover"
            testId="company-cover-edit"
            hasImage={cover !== null}
            onSave={async (v) => {
              await api.setCompanyCover(v);
              setCover(safeCover(v));
            }}
          />
        </div>
      )}
    </div>
  );
}
