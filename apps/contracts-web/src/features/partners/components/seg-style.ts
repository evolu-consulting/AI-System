// V2-I · mockup NITI `.seg`: nhóm nút liền nhau (vai, khoảng biểu đồ, giai đoạn HĐ) — khung + ô đang chọn nổi lên.
export const SEG = "inline-flex flex-wrap gap-0.5 rounded-lg border border-field bg-sunk p-0.5";
export const segItem = (on: boolean): string =>
  `rounded-md px-3 py-1 text-[13px] whitespace-nowrap ${on ? "bg-panel font-semibold text-act shadow-sm" : "text-ink-2 hover:text-ink"}`;
