// niti-onboard · hồ sơ công ty của tenant (admin 0015), chỉ đọc — ghi bằng công cụ onboarding (deploy/tenants/*.yaml).
import type { TenantDetail } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { profileLines } from "../lib/profile";

export function TenantProfileCard({ profile }: { profile: TenantDetail["profile"] }) {
  const { t } = useTranslation();
  const lines = profileLines(profile);
  if (lines.length === 0) return null;
  return (
    <Card className="mt-4 max-w-xl" data-testid="tenant-profile">
      <CardHeader>
        <CardTitle>{t("tenants.profile.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-body">
          {lines.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{t(`tenants.profile.${k}`)}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
