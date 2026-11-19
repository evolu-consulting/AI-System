// CR-187 BR-187-5 · Sổ Hợp Tác › Đối tác: công tắc «Cho công ty khác tìm thấy công ty mình». Chỉ quản trị công ty thấy/đổi.
// Dùng API cũ: đọc hồ sơ `GET /admin/tenants/:id/profile`, đổi `PUT /admin/tenants/:id/directory`. Thiếu tên pháp lý/MST ⇒ khoá + nói lý do.
import type { TenantCompanyProfile } from "@ai/contracts/tenants";
import { api } from "@ai/web-kit/http";
import { Switch } from "@ai/web-kit/ui/kit/switch";
import { notifyError, notifySuccess } from "@ai/web-kit/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSession } from "~/features/auth/hooks/use-session";
import { canSeeDiscoverable, discoverableView } from "../lib/discoverable";

const KEY = (id: string) => ["tenant-profile", id] as const;

export function DiscoverableCard() {
  const me = useSession((s) => s.me);
  if (!me || !canSeeDiscoverable(me.role)) return null;
  return <Body tenantId={me.tenant.id} />;
}

function Body({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.gape.discover.${k}`);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY(tenantId),
    queryFn: ({ signal }) =>
      api<TenantCompanyProfile>(`/admin/tenants/${tenantId}/profile`, { signal }),
  });
  const set = useMutation({
    mutationFn: (listed: boolean) =>
      api<TenantCompanyProfile>(`/admin/tenants/${tenantId}/directory`, {
        method: "PUT",
        body: { listed },
      }),
    onSuccess: (res) => {
      qc.setQueryData(KEY(tenantId), res);
      notifySuccess(L("saved"));
    },
    onError: () => notifyError(L("fail")),
  });
  if (!q.data) return null;
  const v = discoverableView(q.data);
  return (
    <section
      data-testid="discoverable-card"
      className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-rule-soft bg-card px-5 py-4"
    >
      <div className="grid gap-1">
        <label htmlFor="discoverable-switch" className="font-semibold text-ink">
          {L("title")}
        </label>
        <p data-testid="discoverable-why" className="text-[13px] text-dim">
          {v.needProfile ? L("needProfile") : L("why")}
        </p>
      </div>
      <Switch
        id="discoverable-switch"
        data-testid="discoverable-switch"
        checked={v.checked}
        disabled={!v.enabled || set.isPending}
        onCheckedChange={(x) => set.mutate(x)}
      />
    </section>
  );
}
