// nav-v2 · đầu một khối của Tổng quan (mockup NITI `.panel > header`): tiêu đề + chú thích mờ, vạch dưới.
import type { ReactNode } from "react";

export function BlockHead({
  title,
  meta,
  aside,
}: {
  title: string;
  meta?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule-soft px-5 py-3.5">
      <h2 className="text-card-title font-medium">{title}</h2>
      {meta && <p className="text-label text-dim">{meta}</p>}
      {aside && <span className="ml-auto text-label">{aside}</span>}
    </header>
  );
}
