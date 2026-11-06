// CR-121 f3 · chỉ trang DANH SÁCH `/processes` (Thư viện) bị chuyển hướng với tenant_admin / `?tenant=`; mọi trang con
// (`/processes/$id`, `/processes/$id/runs/$runId`, `/processes/new`, `/processes/showcase`) KHÔNG bao giờ bị chuyển hướng ở đây — API chặn chéo công ty.
import type { Role } from "@ai/contracts/common";

/** Đúng danh sách `/processes` (cho phép dấu `/` cuối), không phải trang con. */
export const isProcessesList = (pathname: string): boolean =>
  pathname.replace(/\/+$/, "") === "/processes";

/** Chuyển hướng danh sách chỉ áp dụng khi đang ở danh sách; `target` là kết quả của `processesRedirectTenant`. */
export const listRedirectTarget = (pathname: string, target: string | null): string | null =>
  isProcessesList(pathname) ? target : null;

/** Nút "quay lại" của trang "Không tìm thấy" trong khu Quy trình: tenant_admin không có danh sách thư viện ⇒ về công ty mình. */
export const notFoundBack = (role: Role | undefined): "/tenants" | "/processes" =>
  role === "tenant_admin" ? "/tenants" : "/processes";
