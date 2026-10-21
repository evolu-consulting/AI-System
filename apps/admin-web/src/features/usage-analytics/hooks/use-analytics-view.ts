// ADM-FR-42 · usage-analytics · trạng thái màn Phân tích token lấy từ URL (bộ lọc chia sẻ được); tenant_admin bị ép tenant
// mình (`?tenant=` khác ⇒ 404 như màn Chi phí & quota; server cũng ép theo actor + RLS).
import { useNavigate } from "@tanstack/react-router";
import { useTenantOptions } from "@/features/tenants/api";
import { useSession } from "@/lib/auth/use-session";
import { type AnalyticsParams, useAnalytics } from "../api";
import { type Preset, rangeOf } from "../lib/view";

export type AnalyticsSearch = {
  tenant?: string;
  preset?: string;
  from?: string;
  to?: string;
  grain?: string;
  app?: string;
  agent?: string;
  model?: string;
  user?: string;
  outcome?: string;
};

const NO_DIMS = {
  app: undefined,
  agent: undefined,
  model: undefined,
  user: undefined,
  outcome: undefined,
};

export function useAnalyticsView(search: AnalyticsSearch) {
  const navigate = useNavigate();
  const me = useSession((s) => s.me);
  const platform = me?.role === "platform_admin";
  const options = useTenantOptions(platform);
  const { preset, range, grain } = rangeOf(search, new Date());
  const tenantKey = platform ? (search.tenant ?? null) : null;
  const tenantId = options.data?.find((t) => t.key === tenantKey)?.id;
  const unknownTenant = platform && tenantKey !== null && options.isSuccess && !tenantId;
  const foreign = !platform && !!search.tenant && search.tenant !== me?.tenant.key;
  const waiting = platform && tenantKey !== null && options.isPending;
  const params: AnalyticsParams = {
    tenantId,
    ...range,
    grain,
    app: search.app,
    agentId: search.agent,
    model: search.model,
    userId: search.user,
    outcome: search.outcome,
  };
  const ready = !!me && !foreign && !unknownTenant && !waiting;
  const query = useAnalytics(params, ready);
  const set = (patch: Partial<AnalyticsSearch>) =>
    void navigate({ to: "/usage/analytics", search: { ...search, ...patch }, replace: true });
  return {
    platform,
    preset,
    range,
    grain,
    tenantKey,
    tenants: options.data ?? [],
    search,
    params,
    ready,
    query,
    notFound: foreign || unknownTenant,
    set,
    setPreset: (p: Preset) => set({ preset: p, from: undefined, to: undefined, grain: undefined }),
    clear: () => set(NO_DIMS),
  };
}

export type AnalyticsView = ReturnType<typeof useAnalyticsView>;
