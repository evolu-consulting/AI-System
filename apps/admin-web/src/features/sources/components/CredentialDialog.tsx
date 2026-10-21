// HUB-FR-68 · PC2-R10 · FC2 · bảng "Tạo khoá nguồn": tên + token (chỉ ghi) + hướng dẫn quyền PAT. Hiện INLINE (role=dialog, không
// phải Radix modal lồng nhau — tránh đóng nhầm Sheet/drawer cha). Token KHÔNG vào URL/log/cache (mutation `gcTime: 0`).
import type { HubSecret } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTr } from "@/lib/use-translate";
import { useCredentialCreate } from "../hooks/use-credential-create";

type Props = {
  idPrefix: string;
  tenantId: string | undefined;
  onClose: () => void;
  onCreated: (cred: HubSecret) => void;
};

export function CredentialDialog({ idPrefix, tenantId, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const title = t("process.sources.credential.create.title");
  const { name, setName, value, setValue, errors, alertKey, isPending, submit } =
    useCredentialCreate({
      tenantId,
      onClose,
      onCreated,
    });

  return (
    <div
      role="dialog"
      aria-label={title}
      className="space-y-3 rounded-md border border-border bg-card p-3"
    >
      <p className="font-medium text-body">{title}</p>
      <div className="space-y-3">
        {alertKey ? (
          <Alert variant="destructive">
            <AlertDescription>{tr(alertKey)}</AlertDescription>
          </Alert>
        ) : null}
        <FormField
          id={`${idPrefix}-name`}
          label={t("process.sources.credential.name")}
          error={errors.name}
          alert
        >
          {(p) => (
            <Input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("process.sources.credential.name.ph")}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          )}
        </FormField>
        <FormField
          id={`${idPrefix}-token`}
          label={t("process.sources.credential.token")}
          description={t("process.sources.credential.token.hint")}
          error={errors.value}
          alert
        >
          {(p) => (
            <Input
              {...p}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("process.sources.credential.token.ph")}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          )}
        </FormField>
        <Alert role="note">
          <AlertDescription>{t("process.sources.credential.pat")}</AlertDescription>
        </Alert>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            {t("process.sources.credential.cancel")}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={isPending}>
            {t("process.sources.credential.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
