// app-catalog · hộp thoại Thêm/Sửa ứng dụng (state điều khiển thuần; lỗi 409/400 từ server hiện dưới form).
import { APP_AUDIENCES, type AppCatalogItem, type AppCreateRequest } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const BLANK: AppCreateRequest = {
  key: "",
  name: { vi: "" },
  icon: "app",
  url: "",
  audience: "all",
  required_feature: null,
  sso: true,
  sort_order: 100,
  enabled: true,
};

type Props = {
  /** `null` = thêm mới; có giá trị = sửa (khoá không đổi). */
  initial: AppCatalogItem | null;
  onClose: () => void;
  /** Trả khoá lỗi hiển thị (`keyTaken`/`invalid`/`generic`) hoặc `null` khi lưu xong. */
  onSubmit: (v: AppCreateRequest) => Promise<"keyTaken" | "invalid" | "generic" | null>;
};

function TextField(p: {
  id: string;
  label: string;
  value: string;
  onChange: (s: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`app-${p.id}`}>{p.label}</Label>
      <Input
        id={`app-${p.id}`}
        value={p.value}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.target.value)}
      />
    </div>
  );
}

export function AppFormDialog({ initial, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const [v, setV] = useState<AppCreateRequest>(
    initial ? { ...initial, name: initial.name } : BLANK,
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AppCreateRequest>(k: K, x: AppCreateRequest[K]) =>
    setV((p) => ({ ...p, [k]: x }));
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const fail = await onSubmit({ ...v, name: v.name.en ? v.name : { vi: v.name.vi } });
      if (fail) setErr(t(`apps.error.${fail}`));
      else onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(initial ? "apps.edit" : "apps.create")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <TextField
            id="key"
            label={t("apps.field.key")}
            value={v.key}
            disabled={!!initial}
            onChange={(s) => set("key", s.trim().toLowerCase())}
          />
          <TextField
            id="name-vi"
            label={t("apps.field.nameVi")}
            value={v.name.vi}
            onChange={(s) => set("name", { ...v.name, vi: s })}
          />
          <TextField
            id="name-en"
            label={t("apps.field.nameEn")}
            value={v.name.en ?? ""}
            onChange={(s) => set("name", { ...v.name, en: s })}
          />
          <TextField
            id="icon"
            label={t("apps.field.icon")}
            value={v.icon}
            onChange={(s) => set("icon", s.trim().toLowerCase())}
          />
          <TextField
            id="url"
            label={t("apps.field.url")}
            value={v.url}
            onChange={(s) => set("url", s)}
          />
          <div className="space-y-1.5">
            <Label htmlFor="app-audience">{t("apps.field.audience")}</Label>
            <select
              id="app-audience"
              value={v.audience}
              onChange={(e) => set("audience", e.target.value as AppCreateRequest["audience"])}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {APP_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {t(`apps.audience.${a}`)}
                </option>
              ))}
            </select>
          </div>
          <TextField
            id="feature"
            label={t("apps.field.feature")}
            value={v.required_feature ?? ""}
            onChange={(s) => set("required_feature", s.trim() === "" ? null : s.trim())}
          />
          <TextField
            id="sort"
            label={t("apps.field.sort")}
            value={String(v.sort_order)}
            onChange={(s) => set("sort_order", Number.parseInt(s, 10) || 0)}
          />
          <div className="flex items-center gap-2">
            <Switch id="app-sso" checked={v.sso} onCheckedChange={(c) => set("sso", c)} />
            <Label htmlFor="app-sso">{t("apps.field.sso")}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="app-enabled"
              checked={v.enabled}
              onCheckedChange={(c) => set("enabled", c)}
            />
            <Label htmlFor="app-enabled">{t("apps.field.enabled")}</Label>
          </div>
          {err ? (
            <p role="alert" className="text-label text-destructive">
              {err}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("apps.cancel")}
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {t("apps.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
