// CR-121 c14b · chép mã công ty (artboard Tpl-Settings: "Đã chép"). Trình duyệt chặn clipboard ⇒ nói cách làm (chọn và chép tay).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

export function CopyKeyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  const copy = async () => {
    const ok = await copyText(value);
    setState(ok ? "done" : "fail");
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="copy-tenant-key"
        onClick={() => void copy()}
      >
        {t("tenants.settings.copy")}
      </Button>
      <span role="status" className="text-caption text-muted-foreground">
        {state === "done"
          ? t("tenants.settings.copied")
          : state === "fail"
            ? t("tenants.settings.copyFail")
            : ""}
      </span>
    </>
  );
}
