// HUB-FR-129 · HUB-FR-115 · P-c2 §1.4 · "Cần người quyết" apply_conflict / apply_failed: file xung đột hoặc câu theo `error_code`.
// Bản chép: chat-web `shared/apply/ApplyIssue.tsx` (TECH-DEBT FC11). Render NGOÀI form/modal (bẫy Radix F1).
import type { ApplyStageView, DecisionReason } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { applyErrKey } from "../../../lib/apply-view";
import { AutofixFailures } from "../autofix/AutofixFailures";
import type { LoadContent } from "../autofix/use-autofix-content";

const K = "process.common.apply.";

function ApplyIssueImpl({
  reason,
  apply,
  load,
}: {
  reason: DecisionReason | undefined;
  apply: ApplyStageView | undefined;
  load: LoadContent;
}) {
  const { t } = useTranslation();
  if (reason === "apply_conflict") {
    const files = apply?.conflict_files ?? [];
    return (
      <div className="flex flex-col gap-1">
        <span className="text-caption font-semibold">{t(`${K}conflictFiles`)}</span>
        <ul className="space-y-0.5 rounded-md bg-muted p-2">
          {files.map((f, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: danh sách tĩnh, không sắp xếp lại
              key={i}
              data-testid={`apply-conflict-file-${i}`}
              className="break-all font-mono text-caption"
            >
              {f}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (reason !== "apply_failed") return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{t(applyErrKey(apply?.error_code))}</p>
      {apply?.error_code === "check_failed" && apply.failures.length > 0 && (
        <AutofixFailures view={apply} load={load} />
      )}
    </div>
  );
}

export const ApplyIssue = memo(ApplyIssueImpl);
