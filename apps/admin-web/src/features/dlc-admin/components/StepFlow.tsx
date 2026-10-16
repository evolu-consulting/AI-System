// DLC-R15 · các bước AI SDLC theo chiều chạy (mũi tên trong hàng, đường gấp khúc xuống hàng) — dùng ở Workflow Steps
// (thẻ đầy đủ: agent, model, hook) và ở dialog flow (xem trước gọn).
import type { DlcCatalogResponse, DlcCatalogStep } from "@ai/contracts/hub-admin";
import { ArrowDown, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

const PER_ROW = 4;

function RowConnector() {
  return (
    <div aria-hidden className="relative h-8 text-primary/60">
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
      >
        <polyline
          points="88,0 88,14 12,14 12,32"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <ArrowDown className="absolute bottom-[-6px] left-[12%] size-4 -translate-x-1/2" />
    </div>
  );
}

type Props = {
  steps: readonly DlcCatalogStep[];
  render: (step: DlcCatalogStep, index: number) => ReactNode;
};

export function StepFlow({ steps, render }: Props) {
  const rows: DlcCatalogStep[][] = [];
  for (let i = 0; i < steps.length; i += PER_ROW) rows.push(steps.slice(i, i + PER_ROW));
  return (
    <ol className="flex flex-col">
      {rows.map((row, r) => (
        <li key={row[0]?.id ?? r}>
          {r > 0 && <RowConnector />}
          <div className="flex items-stretch">
            {Array.from({ length: PER_ROW }, (_, c) => {
              const s = row[c];
              return (
                <div key={s?.id ?? `empty-${c}`} className="flex min-w-0 flex-1 items-stretch">
                  {c > 0 && (
                    <div className="flex w-7 shrink-0 items-center justify-center">
                      {s && <ArrowRight aria-hidden className="size-4 text-primary/60" />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">{s && render(s, r * PER_ROW + c)}</div>
                </div>
              );
            })}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Bước của một process theo thứ tự (`processes[].steps`), bỏ id không có trong danh mục. */
export function stepsOf(catalog: DlcCatalogResponse, processId: string): DlcCatalogStep[] {
  const p = catalog.processes.find((x) => x.id === processId);
  const ids = p?.steps ?? catalog.steps.map((s) => s.id);
  return ids.flatMap((id) => catalog.steps.filter((s) => s.id === id));
}
