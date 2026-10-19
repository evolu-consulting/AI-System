// PK-FR-10 · TF5 · dấu hiệu app (hình tròn + trang giấy, màu theo token `act`).
export const Logo = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
    <rect width="32" height="32" rx="9" className="fill-act" />
    <path
      d="M10 8h8l4 4v12H10z"
      className="fill-none stroke-on-act"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="M13 17h6M13 21h4" className="stroke-on-act" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
