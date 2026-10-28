// Biểu tượng inline (chép path từ mockup, stroke currentColor).
import type { ReactNode } from "react";

type P = { size?: number; fill?: boolean };
const svg = (paths: ReactNode, { size = 18, fill = false }: P = {}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {paths}
  </svg>
);

export const IconSearch = (p: P) =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
    p,
  );
export const IconHome = (p: P) =>
  svg(<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />, p);
export const IconBell = (p: P) =>
  svg(
    <>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>,
    p,
  );
export const IconGear = (p: P) =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>,
    p,
  );
export const IconLock = (p: P) =>
  svg(
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>,
    p,
  );
export const IconDots = (p: P) =>
  svg(
    <>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </>,
    { ...p, fill: true },
  );
export const IconEdit = (p: P) => svg(<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />, p);
export const IconArchive = (p: P) =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
    </>,
    p,
  );
export const IconTrash = (p: P) => svg(<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />, p);
export const IconCheck = (p: P) => svg(<path d="M5 12l4 4L19 7" />, p);
export const IconEyeOff = (p: P) =>
  svg(
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.1 3.8M6.5 7.6A16 16 0 0 0 2.5 12S6 18 12 18c1.5 0 2.8-.4 4-1" />
    </>,
    p,
  );
export const IconImage = (p: P) =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m21 16-5-5-9 9" />
    </>,
    p,
  );
export const IconVideo = (p: P) =>
  svg(
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3z" />
    </>,
    p,
  );
export const IconX = (p: P) => svg(<path d="M6 6l12 12M18 6 6 18" />, p);
export const IconChat = (p: P) =>
  svg(<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" />, p);
export const IconSend = (p: P) =>
  svg(
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </>,
    p,
  );
export const IconSave = (p: P) =>
  svg(
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </>,
    p,
  );
export const IconBox = (p: P) =>
  svg(
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </>,
    p,
  );
export const IconPlay = (p: P) => svg(<path d="M8 5v14l11-7z" />, { ...p, fill: true });
export const IconBook = (p: P) =>
  svg(
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </>,
    p,
  );
