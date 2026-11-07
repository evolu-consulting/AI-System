// CR-124 · q4 · FLOW4-FR-14 · thẻ 3 dòng dùng chung hai phía: dòng 1 trạng thái (đậm), dòng 2 lý do, dòng 3 bước kế. Không thêm chữ ngoài 3 dòng.
import { useTranslation } from "react-i18next";
import type { Card, Line } from "../lib/partner-view";

const TONE = { wait: "text-soon", ok: "text-act", bad: "text-late" } as const;

export function useLine() {
  const { t } = useTranslation();
  return (l: Line) => {
    const vars = Object.fromEntries(
      Object.entries(l.vars ?? {}).map(([k, v]) => [
        k,
        typeof v === "string" && v.startsWith("contracts.") ? t(v) : v,
      ]),
    );
    return t(l.key, vars);
  };
}

export function PartnerCard({
  card,
  testId,
  right,
  title,
}: {
  card: Card;
  testId: string;
  right?: React.ReactNode;
  title?: string;
}) {
  const text = useLine();
  const [a, b, c] = card.lines;
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-4 rounded-xl border border-rule bg-sunk px-4 py-3 text-sm"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <span className="truncate font-medium">{title}</span>}
        <span data-testid={`${testId}-status`} className={`font-semibold ${TONE[card.tone]}`}>
          {text(a)}
        </span>
        <span className="truncate text-dim">{text(b)}</span>
        <span className="truncate text-dim">{text(c)}</span>
      </div>
      {right}
    </div>
  );
}
