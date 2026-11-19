// CR-124 q2 · Công ty › Hồ sơ › "Danh bạ công ty": quản trị nền tảng đặt "Đã xác minh" (hiện ngày + người xác minh). Chữ phổ thông, một dòng giải thích.
import type { TenantCompanyProfile } from "@ai/contracts/tenants";
import { Card, CardContent, CardHeader, CardTitle } from "@ai/web-kit/ui/kit/card";
import { Switch } from "@ai/web-kit/ui/kit/switch";
import { notifyError, notifySuccess } from "@ai/web-kit/ui/toast";
import { useTranslation } from "react-i18next";
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
  const verified = useSetDirectory(tenantId);
  const v = directoryView(profile, isPlatform);

  const run = (m: typeof verified) => async (value: boolean) => {
    try {
      await m.mutateAsync(value);
      notifySuccess(t("tenants.company.saved"));
    } catch (e) {
      const spec = describeError(e);
      notifyError(tr(spec.key, spec.params));
    }
  };

  if (!v.verified.visible) return null; // CR-187: công tắc «cho tìm thấy» ở Sổ Hợp Tác; ở đây chỉ còn «Đã xác minh» (quản trị nền tảng)
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
      </CardContent>
    </Card>
  );
}
