// ADM-FR-14 · hộp hướng dẫn 3 bước (ui-admin 7.6), đóng được, nhớ trong localStorage `ai.workflowsGuide`.
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export const GUIDE_STORAGE_KEY = "ai.workflowsGuide";

const readHidden = (): boolean => {
  try {
    return localStorage.getItem(GUIDE_STORAGE_KEY) === "hidden";
  } catch {
    return false;
  }
};

const STEPS = ["s1", "s2", "s3"] as const;

export function WorkflowGuide() {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(readHidden);
  if (hidden) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(GUIDE_STORAGE_KEY, "hidden");
    } catch {
      // trình duyệt chặn localStorage: chỉ ẩn trong phiên này
    }
    setHidden(true);
  };
  return (
    <section
      aria-label={t("workflows.guide.title")}
      className="relative mb-4 rounded-lg border border-border bg-card p-4"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("workflows.guide.dismiss.aria")}
        onClick={dismiss}
        className="absolute top-2 right-2"
      >
        <X aria-hidden />
      </Button>
      <h2 className="mb-3 text-label font-semibold">{t("workflows.guide.title")}</h2>
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-semibold text-accent-foreground">
              {i + 1}
            </span>
            <div>
              <p className="text-label font-medium">{t(`workflows.guide.${s}.title`)}</p>
              <p className="text-caption text-muted-foreground">{t(`workflows.guide.${s}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
