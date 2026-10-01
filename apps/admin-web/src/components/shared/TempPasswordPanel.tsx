// ADM-FR-60, ADM-FR-04 · khối mật khẩu tạm (D10): 4 nhóm 4 ký tự bằng <span> (aria-hidden), ô readOnly giữ chuỗi gốc 16 ký tự.
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { notifyError, notifySuccess } from "./toast";

const GROUP = 4;

export function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

type Props = {
  tenantKey: string;
  username: string;
  password: string;
  /** Gọi khi sao chép thành công (nơi dùng mở khoá nút Đóng / bỏ cảnh báo). */
  onCopied?: () => void;
};

export function TempPasswordPanel({ tenantKey, username, password, onCopied }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyAll = async () => {
    const ok = await copyText(
      t("users.drawer.copyAll.text", { tenant: tenantKey, username, password }),
    );
    if (!ok) {
      notifyError(t("toast.saveFailed", { reason: t("common.copy") }));
      return;
    }
    setCopied(true);
    notifySuccess(t("tempPassword.toast"));
    onCopied?.();
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted p-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
        <dt className="text-muted-foreground">{t("tempPassword.tenant")}</dt>
        <dd className="font-mono">{tenantKey}</dd>
        <dt className="text-muted-foreground">{t("tempPassword.username")}</dt>
        <dd className="font-mono">{username}</dd>
        <dt className="text-muted-foreground">{t("tempPassword.password")}</dt>
        <dd className="relative font-mono text-card-title font-semibold">
          <span aria-hidden className="flex gap-3">
            {chunk(password, GROUP).map((part, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 4 nhóm cố định theo vị trí
              <span key={i}>{part}</span>
            ))}
          </span>
          <input
            readOnly
            aria-label={t("tempPassword.password")}
            value={password}
            className="sr-only"
          />
        </dd>
      </dl>
      <Button variant="outline" size="sm" onClick={copyAll}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {t("tempPassword.copyAll")}
      </Button>
    </div>
  );
}
