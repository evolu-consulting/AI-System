// HUB-FR-134 · K1 F4 · plan-frontend §2 màn 5: ghi chú tri thức trên output — hạ cấp `warning` + "Tri thức: n/5 lần hỏi" + Tóm tắt + `write_to`.
// Copy-then-own (bản chat-web cùng nội dung). `knowledge` vắng ⇒ không render.
import type { StageView } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";

export function KnowledgeNotice({ knowledge }: { knowledge: StageView["knowledge"] }) {
  // Chuỗi `process.*` nạp lười (ngoài kiểu `resources`), nên dùng t không ràng buộc khoá.
  const t = useTranslation().t as (key: string, opt?: Record<string, unknown>) => string;
  if (!knowledge) return null;
  const { warning, queries, query_limit, summary, write_to } = knowledge;
  return (
    <div className="space-y-1">
      {warning !== null && (
        <p
          role="status"
          className="rounded-md border border-warning-bg bg-warning-bg px-3 py-2 text-caption text-warning"
        >
          {t("process.knowledge.warning.head")} {t(`process.knowledge.warning.${warning}`)}
        </p>
      )}
      <p className="text-caption text-secondary-foreground">
        {t("process.knowledge.queries", { queries, limit: query_limit })} ·{" "}
        {t("process.knowledge.summary.label", { state: t(`process.knowledge.summary.${summary}`) })}
        {write_to && (
          <>
            {" "}
            {t("process.knowledge.writeTo", {
              project: write_to.project,
              connection: write_to.connection,
            })}
          </>
        )}
      </p>
    </div>
  );
}
