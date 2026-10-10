// ADM-FR-65 · CR-056 · P-a F5: tenant đang xem ở màn Quy trình. tenant_admin cố định; platform_admin chọn (nhớ trong phiên
// trình duyệt vì route `/processes*` chưa có tham số `?tenant=`). `tenantId` chỉ có với platform_admin (Hub tự lấy từ JWT cho tenant_admin).
import { useSyncExternalStore } from "react";
import { useTenantOptions } from "@/features/tenants/api";
import { useSession } from "@/lib/auth/use-session";
import { resolveViewedTenant } from "@/lib/viewed-tenant";

const STORAGE_KEY = "ai.process.tenant";
const subs = new Set<() => void>();
const store = (): Storage | null => (typeof sessionStorage === "undefined" ? null : sessionStorage);
let current: string | null = store()?.getItem(STORAGE_KEY) ?? null;

export function setProcessTenant(key: string | null): void {
  current = key;
  if (key === null) store()?.removeItem(STORAGE_KEY);
  else store()?.setItem(STORAGE_KEY, key);
  for (const f of subs) f();
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

export function useProcessTenant() {
  const me = useSession((s) => s.me);
  const key = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const options = useTenantOptions(me?.role === "platform_admin");
  const tn = resolveViewedTenant(me, key ?? undefined, options);
  return { me, ...tn, setTenant: setProcessTenant };
}
export type ProcessTenant = ReturnType<typeof useProcessTenant>;
