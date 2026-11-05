// CR-118 · cr118-feature-gate-web · React: `<FeatureRoot>` nạp cờ rồi mới vẽ con; `useFeature`/`useCan`/`<FeatureGate>`.
import { OpenFeatureProvider, useBooleanFlagValue } from "@openfeature/react-sdk";
import { OpenFeature } from "@openfeature/web-sdk";
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { FEATURE_DOMAIN, source } from "../gate";
import { createPackMeProvider } from "../lib/provider";

// Provider tạo lười (không side-effect ở mức module ⇒ import index không kéo OpenFeature nếu không dùng hook).
let provider: ReturnType<typeof createPackMeProvider> | null = null;
const getProvider = () => (provider ??= createPackMeProvider(source));

/** Cờ boolean (`contracts`, `community.write`, khoá add-on). `fallback` dùng khi chưa có ảnh (lỗi mạng). */
export function useFeature(flag: string, fallback = false): boolean {
  return useBooleanFlagValue(flag, fallback);
}

/** Nhiều cờ một lần (menu theo manifest, CR-120): cùng ngữ nghĩa provider — chưa có ảnh ⇒ `fallbacks[k]` (mặc định tắt), có ảnh ⇒ cờ phải bằng true. */
export function useFeatures(
  keys: readonly string[],
  fallbacks: Readonly<Record<string, boolean>> = {},
): Record<string, boolean> {
  const snap = useSyncExternalStore(
    (cb) => source.subscribe(cb),
    () => source.snapshot(),
    () => null,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: keys/fallbacks là hằng của chỗ gọi
  return useMemo(
    () =>
      Object.fromEntries(
        keys.map((k) => [k, snap ? snap.flags[k] === true : (fallbacks[k] ?? false)]),
      ),
    [snap, keys.join("|")],
  );
}

/** Quyền hành động của gói: `useCan("contracts", "write")` = cờ `contracts.write`. */
export const useCan = (pack: string, action: string, fallback = false): boolean =>
  useFeature(`${pack}.${action}`, fallback);

export function FeatureGate({
  flag,
  fallbackValue = false,
  otherwise = null,
  children,
}: {
  flag: string;
  fallbackValue?: boolean;
  otherwise?: ReactNode;
  children: ReactNode;
}) {
  const on = useFeature(flag, fallbackValue);
  return on ? children : otherwise;
}

/** Gắn trong vùng đã đăng nhập: bật nguồn (SSE + focus), nạp ảnh đầu, hết phiên/gỡ ⇒ dừng + xoá ảnh. */
export function FeatureRoot({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let off = false;
    source.start();
    void (async () => {
      try {
        await source.refresh().catch(() => {}); // lỗi mạng ⇒ vẽ với giá trị mặc định của chỗ gọi
        await OpenFeature.setProviderAndWait(FEATURE_DOMAIN, getProvider());
        const me = source.snapshot()?.user;
        if (me) {
          await OpenFeature.setContext(FEATURE_DOMAIN, {
            targetingKey: me.id,
            tenantId: me.tenant_id,
          });
        }
      } finally {
        if (!off) setReady(true);
      }
    })();
    return () => {
      off = true;
      source.stop();
    };
  }, []);
  if (!ready) return null;
  return <OpenFeatureProvider domain={FEATURE_DOMAIN}>{children}</OpenFeatureProvider>;
}
