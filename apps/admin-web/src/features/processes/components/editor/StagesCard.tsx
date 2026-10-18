// ADM-FR-66 · CR-056 · P-a F5 · P-b2: thẻ "Giai đoạn" (bàn làm việc theo bước, ≤ 10) và thẻ "Giới hạn" chỉ đọc.
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import { PROCESS_TTL_DAYS } from "../../domain/limits";
import { ttlToValue } from "../../domain/ttl-rules";
import type { DraftState } from "../../hooks/use-draft";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { StageWorkbench } from "../canvas/StageWorkbench";

type Props = { d: DraftState; readOnly: boolean; refs: EditorRefs };

export function StagesCard({ d, readOnly, refs }: Props) {
  const { t } = useTranslation();
  const err = d.errors.stages;
  return (
    <Panel title={t("process.admin.editor.stages")}>
      {err ? (
        <p role="alert" className="text-label text-destructive">
          {t(err)}
        </p>
      ) : null}
      <StageWorkbench d={d} readOnly={readOnly} refs={refs} />
    </Panel>
  );
}

/** Thẻ Giới hạn: số ngày theo `ttl` của bản nháp (hợp lệ) hoặc "Không hết hạn"; mặc định 7 khi ô đang lỗi. */
export function LimitsCard({ ttl, noExpiry }: { ttl: string; noExpiry: boolean }) {
  const { t } = useTranslation();
  const days = ttlToValue(ttl, noExpiry) ?? PROCESS_TTL_DAYS.default;
  return (
    <Panel title={t("process.admin.editor.limits")}>
      <p className="text-body text-muted-foreground">
        {noExpiry
          ? t("process.admin.editor.limitsTextNoTtl")
          : t("process.admin.editor.limitsTextTtl", { days })}
      </p>
      <p className="text-caption text-muted-foreground">{t("process.admin.editor.limitsWait")}</p>
    </Panel>
  );
}
