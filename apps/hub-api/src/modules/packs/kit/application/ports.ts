// PK-FR-03 · PK-FR-09 · ADR-0023 (khuôn `TenantUow`) · N1 plan §4: cổng Unit of Work của module gói. Mỗi gói tự khai `R`
// (repo trong tx của gói); adapter `pack-uow.ts` mở tx qua `withPackScope` (role `<k>_rw` + `app.tenant_id`, RLS FORCE).
// Lớp 2 — chỉ kiểu, không import gì ngoài domain/application.

/** Ai gọi: lấy từ JWT (không bao giờ từ body/query — PK-AC10). */
export type PackWho = { tenantId: string; userId: string };

/** Request người dùng: một tx RLS theo tenant của token; repo `R` dựng trong tx đó. */
export type PackUow<R> = {
  tenant<T>(who: PackWho, fn: (r: R) => Promise<T>): Promise<T>;
};

/** Vòng nền theo từng tenant (PK-FR-03): đặt `app.tenant_id`, không user. Quét chéo tenant không ở N1 (D-12). */
export type PackSystemUow<R> = {
  system<T>(tenantId: string, fn: (r: R) => Promise<T>): Promise<T>;
};
