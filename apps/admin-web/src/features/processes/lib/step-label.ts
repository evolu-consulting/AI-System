// HUB-FR-104 · P-b2 (plan-frontend FB12): đếm bước từ 1 ở giao diện; contract/draft 0-based. Một chỗ chuyển đổi.
/** Số bước hiển thị ("Bước 1") của bước 0-based. */
export const stepLabel = (step: number): number => step + 1;
/** Bước 0-based từ số người dùng nhập (1…). */
export const stepFromLabel = (label: number): number => label - 1;
