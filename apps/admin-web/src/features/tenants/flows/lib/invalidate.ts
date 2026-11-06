// CR-121 f8 · MỘT chỗ làm tươi dữ liệu Công ty › Quy trình của một công ty: năng lực (app → việc, mức app), luật định tuyến mọi việc,
// thân quy trình/bản thư viện/lượt chạy, vai theo ứng dụng và tóm tắt "x/y việc". Gọi sau MỌI thay đổi ảnh hưởng tới các dữ liệu này:
// gán/đổi/bỏ gán/lưu luật (tab Quy trình) và lưu mức ứng dụng/tính năng (tab Ứng dụng) — nếu không, tab kia giữ dữ liệu cũ tới khi tải lại.
import type { QueryClient } from "@tanstack/react-query";

export const companyFlowKeys = (tenantId: string): readonly (readonly string[])[] => [
  ["process", "assigned", "caps", tenantId], // năng lực công ty: app, mức, khe
  ["process", "routing", tenantId], // luật + tập gán mọi việc (gồm thân quy trình)
  ["process", "company-lib", tenantId],
  ["process", "company-runs", tenantId],
  ["process", "tenant-slots"],
  ["tenants", "app-roles", tenantId], // tóm tắt đầu trang
];

export function invalidateCompanyFlows(
  qc: Pick<QueryClient, "invalidateQueries">,
  tenantId: string,
): Promise<unknown> {
  return Promise.all(
    companyFlowKeys(tenantId).map((queryKey) => qc.invalidateQueries({ queryKey })),
  );
}
