// Điểm vào tải lười của module (manifest.loadCommunityPage): dựng API + ngữ cảnh rồi Shell chọn Bảng tin/Hồ sơ theo route.
// CSS Community nằm ở chunk này (không vào bundle đầu); mọi quy tắc dưới [data-mod="community"].
import { use, useEffect } from "react";
import { AppProvider } from "../application/ctx";
import { type CommunityHost, getCommunityHostConfig } from "../application/host";
import { createRouterPort } from "../application/router-port";
import { createApi } from "../application/runtime";
import { mapLegacyHash } from "../domain/legacy-hash";
import { initLang } from "../i18n";
import { Shell } from "./Shell";
import "./styles/community.css";

/** Manifest chờ promise này trước khi dựng route ⇒ `use` không treo, không nháy key. */
/** Link cũ `/community#/profile/<o>/<s>` (301 từ community.<d> giữ fragment) → URL chuẩn, thay mục lịch sử. */
function redirectLegacyHash(): void {
  const to = mapLegacyHash(location.hash);
  if (to) getCommunityHostConfig()?.low.navigate(to, { replace: true });
}

export const ready = Promise.all([createApi(), initLang()]);

let host: CommunityHost | undefined;
function hostOf(): CommunityHost {
  if (host) return host;
  const cfg = getCommunityHostConfig();
  if (!cfg) throw new Error("Chưa gọi configureCommunityHost"); // i18n-ignore: lỗi lập trình
  const { low, ...rest } = cfg;
  host = { ...rest, router: createRouterPort(low) };
  return host;
}

export default function CommunityEntry() {
  const [boot] = use(ready);
  useEffect(redirectLegacyHash, []);
  return (
    <AppProvider boot={boot} host={hostOf()}>
      <Shell />
    </AppProvider>
  );
}
