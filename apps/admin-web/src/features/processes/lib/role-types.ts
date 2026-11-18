// CR-182 · kiểu lá dùng chung của «Theo vai» (không import gì trong lib/ để tránh vòng).
/** Vai của bước Duyệt/Ký: khoá slug + nhãn (khớp `StageRoleSchema` của contract). */
export type StageRole = { key: string; label: string };
