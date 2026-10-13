// HUB-FR-66 · D6 · mockup H4b2-Runbook (F3): Sheet tĩnh "Đăng nhập CLI · {key}" — 3 bước, lệnh theo hãng lấy từ i18n,
// nút Sao chép (`navigator.clipboard`, báo bằng `status`). [Kiểm tra lại] đóng Sheet rồi mở CheckDialog dùng chung.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import type { ProviderItem } from "../hooks/use-providers";
import { loginCommandKey } from "../lib/check-text";
import { statusKey } from "../lib/status";

type Copied = { n: number; ok: boolean } | null;

function Step({
  n,
  title,
  cmd,
  hint,
  onCopy,
}: {
  n: number;
  title: string;
  cmd?: string;
  hint?: string;
  onCopy?: (n: number, cmd: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="space-y-1.5">
      <p className="font-medium">
        {n}. {title}
      </p>
      {cmd ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md bg-muted px-2.5 py-1.5 font-mono text-micro">
            {cmd}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("models.guide.copyAria", { n })}
            onClick={() => onCopy?.(n, cmd)}
          >
            {t("models.guide.copy")}
          </Button>
        </div>
      ) : null}
      {hint ? <p className="text-label text-muted-foreground">{hint}</p> : null}
    </li>
  );
}

export function RunbookSheet({
  provider,
  onClose,
  onCheck,
}: {
  provider: ProviderItem | null;
  onClose: () => void;
  onCheck: (p: ProviderItem) => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<Copied>(null);
  const cmdKey = provider ? loginCommandKey(provider.vendor) : null;
  const copy = async (n: number, cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied({ n, ok: true });
    } catch {
      setCopied({ n, ok: false });
    }
  };
  const close = () => {
    setCopied(null);
    onClose();
  };
  return (
    <Sheet open={provider !== null} onOpenChange={(o) => !o && close()}>
      <SheetContent className="sm:max-w-md" showCloseButton={false}>
        <SheetHeader>
          <SheetTitle>{t("models.guide.title", { key: provider?.key ?? "" })}</SheetTitle>
          <SheetDescription className="sr-only">{t("models.guide.lead")}</SheetDescription>
        </SheetHeader>
        {provider ? (
          <div className="space-y-4 px-4">
            <p
              role="status"
              className="flex items-center gap-2 rounded-lg bg-danger-bg px-3 py-2.5 text-danger"
            >
              <Badge variant="err">{statusKey(provider)}</Badge>
              <span>{t("models.guide.lead")}</span>
            </p>
            <ol className="space-y-4">
              <Step
                n={1}
                title={t("models.guide.step1")}
                cmd={t("models.guide.cmd1")}
                onCopy={copy}
              />
              <Step
                n={2}
                title={t("models.guide.step2")}
                cmd={cmdKey ? t(cmdKey) : undefined}
                hint={cmdKey ? undefined : t("models.guide.cmd2.other")}
                onCopy={copy}
              />
              <Step
                n={3}
                title={t("models.guide.step3")}
                hint={`${t("models.guide.step3Hint")} ${t("models.guide.step3Result")}`}
              />
            </ol>
            <p
              role="status"
              aria-live="polite"
              className={`min-h-5 text-label ${copied?.ok === false ? "text-danger" : "text-success"}`}
            >
              {copied ? t(copied.ok ? "models.guide.copied" : "models.guide.copyFail") : ""}
            </p>
            <p className="text-label text-muted-foreground">{t("models.guide.note")}</p>
          </div>
        ) : null}
        <SheetFooter className="flex-row justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            {t("models.check.close")}
          </Button>
          <Button type="button" onClick={() => provider && onCheck(provider)}>
            {t("models.provider.action.recheck")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
