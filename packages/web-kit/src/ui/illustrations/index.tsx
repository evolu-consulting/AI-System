// CR-131 · hình minh hoạ nét mảnh cho EmptyState (120×90, SVG inline, màu qua currentColor + token --primary). Trang trí ⇒ aria-hidden.
import type { ReactElement } from "react";

export type EmptyKind = "empty" | "search" | "notFound" | "off" | "error";

const A = { stroke: "var(--primary, currentColor)", fill: "none" } as const;

function Frame({ children }: { children: ReactElement | ReactElement[] }) {
  return (
    <svg
      width="120"
      height="90"
      viewBox="0 0 120 90"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="60" cy="80" rx="34" ry="4" strokeOpacity=".25" />
      {children}
    </svg>
  );
}

/** Chưa có dữ liệu: khay trống + vài tia sáng. */
const Empty = () => (
  <Frame>
    <path d="M26 46 38 22h44l12 24v22a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4Z" />
    <path d="M26 46h24a4 4 0 0 1 4 4 6 6 0 0 0 12 0 4 4 0 0 1 4-4h24" />
    <path d="M60 8v6M44 12l3 5M76 12l-3 5" {...A} />
  </Frame>
);

/** Lọc không ra: kính lúp trên trang giấy. */
const Search = () => (
  <Frame>
    <path d="M30 14h34l12 12v40H30Z" />
    <path d="M64 14v12h12M38 36h20M38 46h14" strokeOpacity=".6" />
    <circle cx="76" cy="58" r="14" {...A} />
    <path d="m86 68 12 12" {...A} />
  </Frame>
);

/** Không tìm thấy / không có quyền: trang giấy gấp góc + dấu hỏi. */
const NotFound = () => (
  <Frame>
    <path d="M34 12h36l16 16v50H34Z" />
    <path d="M70 12v16h16" strokeOpacity=".6" />
    <path d="M52 44a8 8 0 1 1 11 7c-2 1-3 3-3 5" {...A} />
    <circle cx="60" cy="64" r=".8" {...A} />
  </Frame>
);

/** Tính năng chưa bật: công tắc tắt. */
const Off = () => (
  <Frame>
    <rect x="30" y="30" width="60" height="32" rx="16" />
    <circle cx="46" cy="46" r="9" {...A} />
    <path d="M60 18v6M44 20l3 4M76 20l-3 4" strokeOpacity=".5" />
  </Frame>
);

/** Mất kết nối: phích cắm rời ổ. */
const Err = () => (
  <Frame>
    <path d="M18 62h22M80 62h22" />
    <path d="M40 50h10v24H40ZM70 50h10v24H70Z" />
    <path d="M50 56h6M64 56h6" strokeOpacity=".6" />
    <path d="M56 28l-4 10h8l-4 10" {...A} />
  </Frame>
);

export const ILLUSTRATIONS: Record<EmptyKind, () => ReactElement> = {
  empty: Empty,
  search: Search,
  notFound: NotFound,
  off: Off,
  error: Err,
};
