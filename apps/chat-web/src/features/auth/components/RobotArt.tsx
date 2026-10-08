// CR-052 phương án C · robot minh hoạ trang trí cho cột showcase của màn Đăng nhập (aria-hidden, không mang nghĩa).
type Props = { tip: string; className?: string };

/** Robot lớn ở góc phải tiêu đề showcase (≈104×124). `tip` = màu chấm ăng-ten. */
export function RobotHero({ tip, className }: Props) {
  return (
    <svg
      width="104"
      height="124"
      viewBox="0 0 160 190"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <line
        x1="80"
        y1="14"
        x2="80"
        y2="34"
        stroke="#818cf8"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="80" cy="12" r="8" fill={tip} />
      <rect x="28" y="34" width="104" height="78" rx="24" fill="#818cf8" />
      <rect x="16" y="58" width="12" height="30" rx="6" fill="#6366f1" />
      <rect x="132" y="58" width="12" height="30" rx="6" fill="#6366f1" />
      <rect x="42" y="48" width="76" height="48" rx="16" fill="#1e1b4b" />
      <circle cx="64" cy="70" r="8" fill="#67e8f9" />
      <circle cx="96" cy="70" r="8" fill="#67e8f9" />
      <path
        d="M68 84 Q80 92 92 84"
        stroke="#67e8f9"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="68" y="112" width="24" height="10" fill="#6366f1" />
      <rect x="40" y="122" width="80" height="60" rx="18" fill="#a5b4fc" />
      <circle cx="80" cy="150" r="10" fill="#4f46e5" />
      <circle cx="80" cy="150" r="4" fill="#67e8f9" />
      <rect
        x="18"
        y="128"
        width="16"
        height="40"
        rx="8"
        fill="#818cf8"
        transform="rotate(20 26 128)"
      />
      <rect
        x="126"
        y="128"
        width="16"
        height="40"
        rx="8"
        fill="#818cf8"
        transform="rotate(-150 134 128)"
      />
    </svg>
  );
}

/** Avatar robot nhỏ (agent trong cửa sổ mẫu). `tip` = màu chấm ăng-ten, phân biệt từng agent. */
export function RobotAvatar({ tip, size = 28 }: { tip: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <line x1="32" y1="6" x2="32" y2="14" stroke="#818cf8" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="5" r="4" fill={tip} />
      <rect x="8" y="14" width="48" height="38" rx="12" fill="#818cf8" />
      <rect x="14" y="21" width="36" height="22" rx="8" fill="#1e1b4b" />
      <circle cx="24" cy="31" r="4" fill="#67e8f9" />
      <circle cx="40" cy="31" r="4" fill="#67e8f9" />
    </svg>
  );
}
