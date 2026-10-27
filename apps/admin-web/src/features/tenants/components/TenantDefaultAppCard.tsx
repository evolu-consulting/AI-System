// tenant-default-app · ô "App mặc định" của công ty (chỉ platform_admin, trang chi tiết tenant): app mở sau đăng nhập cho
// thành viên chưa tự chọn. Giá trị rỗng = chưa đặt ⇒ Trang chủ AI System. Danh sách = catalog đang bật. Lưu ngay khi chọn.
import type {
  AppCatalogItem,
  AppCatalogListResponse,
  DefaultAppRequest,
  TenantDefaultAppResponse,
} from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { describeError } from "@/lib/errors";
import { api } from "@/lib/http";
import { useTr } from "@/lib/use-translate";

const keyOf = (id: string) => ["tenants", "default-app", id] as const;
const pathOf = (id: string) => `/admin/tenants/${encodeURIComponent(id)}/default-app`;

function label(name: AppCatalogItem["name"], lang: string, fallback: string): string {
  const n = name as Record<string, string | undefined>;
  return n[lang] ?? n.vi ?? n.en ?? fallback;
}

export function TenantDefaultAppCard({ tenant }: { tenant: { id: string; name: string } }) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const qc = useQueryClient();
  const current = useQuery({
    queryKey: keyOf(tenant.id),
    queryFn: () => api<TenantDefaultAppResponse>(pathOf(tenant.id)),
  });
  const apps = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<AppCatalogListResponse>("/admin/apps"),
  });
  const save = useMutation({
    mutationFn: (body: DefaultAppRequest) =>
      api<TenantDefaultAppResponse>(pathOf(tenant.id), { method: "PUT", body }),
    onSuccess: (r) => {
      qc.setQueryData(keyOf(tenant.id), r);
      notifySuccess(t("tenants.defaultApp.saved", { tenant: tenant.name }));
    },
    onError: (err) => {
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
    },
  });

  const value = current.data?.app ?? "";
  const items = (apps.data?.items ?? []).filter((a) => a.enabled || a.key === value);
  return (
    <Card className="mt-4 max-w-xl" data-testid="tenant-default-app">
      <CardHeader>
        <CardTitle>{t("tenants.defaultApp.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <Label htmlFor="tenant-default-app">{t("tenants.defaultApp.label")}</Label>
        <select
          id="tenant-default-app"
          value={value}
          disabled={current.isPending || apps.isPending || save.isPending}
          onChange={(e) => save.mutate({ app: e.target.value === "" ? null : e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">{t("tenants.defaultApp.none")}</option>
          {items.map((a) => (
            <option key={a.key} value={a.key}>
              {label(a.name, i18n.language, a.key)}
            </option>
          ))}
        </select>
        <p className="text-caption text-muted-foreground">{t("tenants.defaultApp.hint")}</p>
      </CardContent>
    </Card>
  );
}
