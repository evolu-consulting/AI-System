// CR-122 · p22 · cài đặt nền tảng "Số bước tối đa của một quy trình" (platform_admin): mặc định 22, trần 50. Trình sửa quy trình đọc giá trị này
// (nút "Thêm bước", canvas); Hub từ chối lưu quy trình dài hơn. Một ô số + Lưu; lỗi 400/422 hiện ngay dưới ô.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProcessLimits, useSaveProcessLimits } from "../api";

export function ProcessLimitPanel() {
  const { t } = useTranslation();
  const q = useProcessLimits();
  const save = useSaveProcessLimits();
  const [draft, setDraft] = useState<string | null>(null);
  const lim = q.data;
  if (!lim) return null;
  const raw = draft ?? String(lim.stages_max);
  const n = Number(raw);
  const bad = raw.trim() === "" || !Number.isInteger(n) || n < 1 || n > lim.ceiling;
  const dirty = draft !== null && n !== lim.stages_max;
  const onSave = async () => {
    try {
      await save.mutateAsync({ stages_max: n });
      setDraft(null);
      notifySuccess(t("system.process.saved"));
    } catch {
      notifyError(t("toast.saveFailed"));
    }
  };
  return (
    <section aria-labelledby="sys-process" className="space-y-3" data-testid="process-limit">
      <div>
        <h2 id="sys-process" className="text-lg font-semibold">
          {t("system.process.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("system.process.desc")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={lim.ceiling}
          aria-label={t("system.process.label")}
          aria-invalid={bad ? true : undefined}
          className="w-24"
          data-testid="process-stages-max"
          value={raw}
          onChange={(e) => setDraft(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {t("system.process.unit")} (
          {t("system.process.range", { max: lim.ceiling, default: lim.default })})
        </span>
        <Button
          type="button"
          disabled={!dirty || bad || save.isPending}
          onClick={() => void onSave()}
        >
          {save.isPending ? t("system.config.saving") : t("system.config.save")}
        </Button>
      </div>
    </section>
  );
}
