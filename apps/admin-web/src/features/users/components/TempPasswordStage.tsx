// ADM-FR-04 · bước hiện mật khẩu tạm trong drawer sau khi tạo user (D10): Mã công ty, Tên đăng nhập, Mật khẩu tạm, Sao chép tất cả.
import { useTranslation } from "react-i18next";
import { TempPasswordPanel } from "@/components/shared/TempPasswordPanel";

type Props = { tenantKey: string; username: string; password: string; onCopied: () => void };

export function TempPasswordStage({ tenantKey, username, password, onCopied }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="text-body text-muted-foreground">{t("tempPassword.body")}</p>
      <TempPasswordPanel
        tenantKey={tenantKey}
        username={username}
        password={password}
        onCopied={onCopied}
      />
      <p className="text-caption text-muted-foreground">{t("tempPassword.closeWarning")}</p>
    </div>
  );
}
