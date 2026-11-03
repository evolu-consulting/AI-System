// CR-113 · hộp "Luật duyệt" dưới sơ đồ quy trình: Toàn quyền duyệt thay + quá hạn tự chuyển cấp (mặc định Toàn quyền).
import { useTranslation } from "react-i18next";
import { type CurrentFlow, ruleFacts } from "../lib/current-flow";

export function FlowRules({ flow }: { flow: CurrentFlow }) {
  const { t } = useTranslation();
  const f = ruleFacts(flow);
  const k = (s: string) => `contracts.flow.current.rules.${s}`;
  const target = f.targets.length > 0 ? f.targets.join(", ") : t(k("escalateTargetDefault"));
  return (
    <section
      className="mb-4 rounded-lg border border-rule bg-sunk px-3 py-2 text-caption"
      data-testid="flow-rules"
      aria-label={t(k("title"))}
    >
      <h3 className="mb-1 font-semibold">{t(k("title"))}</h3>
      <ul className="list-disc space-y-0.5 pl-4 text-dim">
        {f.owner && (
          <li data-testid="flow-rule-owner">
            {f.ownerGroup ? t(k("owner"), { group: f.ownerGroup }) : t(k("ownerNoName"))}
          </li>
        )}
        <li data-testid="flow-rule-escalate">{t(k("escalate"), { target })}</li>
      </ul>
    </section>
  );
}
