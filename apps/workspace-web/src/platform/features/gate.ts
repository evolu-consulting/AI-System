// CR-118 · cr118-feature-gate-web · singleton nguồn `/pack/me` (nhẹ, không kéo OpenFeature vào bundle đầu; provider tạo ở ui/FeatureGate).
import { fetchPackMe, listenConfigChanged } from "./adapters/http";
import { createPackMeSource } from "./lib/pack-me-source";

export const FEATURE_DOMAIN = "platform";

export const source = createPackMeSource({
  fetch: fetchPackMe,
  listen: listenConfigChanged,
  focus: typeof window === "undefined" ? null : window,
});

/** `/pack/me.apps` cho `platform/auth` (`setAppsSource(featureAppsSource)`): id module web user mở được. */
export const featureAppsSource = async (): Promise<readonly string[]> =>
  (await source.ensure()).apps;

/** `/pack/me.home` (khoá gói) cho `platform/auth` (`setHomeSource`). */
export const featureHomeSource = async (): Promise<string | null> => (await source.ensure()).home;

/** Cờ phẳng của `/pack/me.flags` (ảnh đã nạp ở khởi động ⇒ không thêm yêu cầu mạng); vắng/lỗi tải ảnh ⇒ false. */
export const featureFlag = (key: string): Promise<boolean> =>
  source.ensure().then(
    (me) => me.flags[key] === true,
    () => false,
  );

/** API khác trả 403 (gói vừa tắt) ⇒ tải lại cờ. */
export const reportForbidden = (): void => source.reportForbidden();
