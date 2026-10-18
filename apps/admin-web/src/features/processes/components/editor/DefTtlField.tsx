// ADM-FR-71 · HUB-FR-115 · P-d1 T11b (plan-frontend §2 "Thẻ Thông tin"; mockup A4): "Thời hạn lượt chạy (ngày)" 1…365 +
// "Không hết hạn" (bật ⇒ ô số tắt, rỗng, gửi `ttl_days: null`).
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PROCESS_TTL_DAYS } from "../../domain/limits";
import { ttlFromValue } from "../../domain/ttl-rules";
import type { DefDraft } from "../../lib/def-form";
import { TextField } from "./Fields";

type Props = {
  draft: Pick<DefDraft, "ttl" | "noExpiry">;
  /** Câu lỗi đã dịch. */
  error?: string;
  readOnly: boolean;
  patch: (p: Partial<Pick<DefDraft, "ttl" | "noExpiry">>) => void;
};

export function DefTtlField({ draft, error, readOnly, patch }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <TextField
        id="pd-ttl"
        label={t("process.admin.editor.ttl")}
        type="number"
        min={PROCESS_TTL_DAYS.min}
        max={PROCESS_TTL_DAYS.max}
        value={draft.noExpiry ? "" : draft.ttl}
        disabled={draft.noExpiry}
        readOnly={readOnly}
        description={t("process.admin.editor.ttlHint")}
        alert
        error={error}
        onChange={(v) => patch({ ttl: v })}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id="pd-no-expiry"
          checked={draft.noExpiry}
          disabled={readOnly}
          onCheckedChange={(v) =>
            patch(
              v === true
                ? { noExpiry: true }
                : {
                    noExpiry: false,
                    ttl: draft.ttl || ttlFromValue(PROCESS_TTL_DAYS.default).text,
                  },
            )
          }
        />
        <Label htmlFor="pd-no-expiry">{t("process.admin.editor.noExpiry")}</Label>
      </div>
    </div>
  );
}
