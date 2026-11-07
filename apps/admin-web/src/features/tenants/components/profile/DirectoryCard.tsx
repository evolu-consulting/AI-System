// CR-124 q2 · Công ty › Hồ sơ › "Danh bạ công ty": quản trị công ty bật/tắt cho công ty khác tìm thấy (mặc định tắt);
// quản trị nền tảng đặt "Đã xác minh" (hiện ngày + người xác minh). Chữ phổ thông, một dòng giải thích.
import type { TenantCompanyProfile } from "@ai/contracts/tenants";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/lib/errors";
import { useTr } from "@/lib/use-translate";
import { useSetDirectory } from "../../hooks/use-tenant-api";
import { directoryView } from "../../lib/directory";

type Props = { tenantId: string; profile: TenantCompanyProfile; isPlatform: boolean };

function Row(p: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  enabled: boolean;
  busy: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="grid gap-1">
        <label htmlFor={p.id} className="text-body font-medium">
          {p.label}
        </label>
        <p className="text-caption text-muted-foreground">{p.hint}</p>
      </div>
      <Switch
        id={p.id}
        checked={p.checked}
        disabled={!p.enabled || p.busy}
        onCheckedChange={p.onChange}
        data-testid={p.id}
      />
    </div>
  );
}

export function DirectoryCard({ tenantId, profile, isPlatform }: Props) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const listed = useSetDirectory(tenantId, "listed");
  const verified = useSetDirectory(tenantId, "verified");
  const v = directoryView(profile, isPlatform);

  const run = (m: typeof listed) => async (value: boolean) => {
    try {
      await m.mutateAsync(value);
      notifySuccess(t("tenants.company.saved"));
    } catch (e) {
      const spec = describeError(e);
      notifyError(tr(spec.key, spec.params));
    }
  };

  const when = v.verified.at
    ? new Date(v.verified.at).toLocaleDateString(i18n.language === "en" ? "en-GB" : "vi-VN")
    : "";
  return (
    <Card data-testid="tenant-directory">
      <CardHeader>
        <CardTitle>{t("tenants.directory.title")}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        <Row
          id="dir-listed"
          label={t("tenants.directory.listed")}
          hint={
            v.listed.needProfile
              ? t("tenants.directory.needProfile")
              : t("tenants.directory.listedWhy")
          }
          checked={v.listed.checked}
          enabled={v.listed.enabled}
          busy={listed.isPending}
          onChange={(x) => void run(listed)(x)}
        />
        {v.verified.visible ? (
          <Row
            id="dir-verified"
            label={t("tenants.directory.verified")}
            hint={
              v.verified.checked
                ? t("tenants.directory.verifiedBy", { date: when, name: v.verified.by ?? "—" })
                : t("tenants.directory.verifiedWhy")
            }
            checked={v.verified.checked}
            enabled={v.verified.enabled}
            busy={verified.isPending}
            onChange={(x) => void run(verified)(x)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
