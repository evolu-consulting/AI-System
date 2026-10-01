// ADM-FR-20 · khung một bước của editor command: số bước + tiêu đề + nội dung.
import type { ReactNode } from "react";
import { useId } from "react";

type Props = { n: number; title: string; children: ReactNode };

export function StepSection({ n, title, children }: Props) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-lg border border-border bg-card p-5">
      <h2 id={id} className="flex items-center gap-2 text-label font-semibold">
        <span
          aria-hidden
          className="flex size-6 items-center justify-center rounded-full bg-accent text-caption text-accent-foreground"
        >
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
