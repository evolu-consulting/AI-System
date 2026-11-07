// CR-125 · m5 · MOD-FR-05 · binding bước cơ bản `core` (Duyệt, Nếu, Gửi email, Thông báo chuông, Kết thúc, Hẹn giờ, Chờ khoảng):
// GHI NHẬN executor lõi mà engine đã chạy sẵn (`approve|if|notify|set|wait_until|wait_for`) vào sổ module — KHÔNG đổi cách engine chạy.
// Danh sách node đọc từ `CORE_MODULE` (MỘT nguồn); thêm bước cơ bản = thêm khai báo ở contracts, không sửa file này.
import { CORE_MODULE } from "@ai/contracts/modules";
import { type ModuleRegistry, moduleRegistry } from "../../kit/public";

/**
 * CR-125 · m8 · đầu ra mà engine ĐÃ ghi vào `process_outputs.fields` của bước cơ bản: Duyệt ghi `decision` + `decided_by` + `feedback`
 * (`processes/gates/approve-out.ts`, cùng tx với quyết định). CR-125 m9 · Thông báo (chuông / email) ghi `sent_to` = tên người nhận
 * (`processes/nodes/notify/launch.ts`, cùng câu INSERT output).
 * Thêm đầu ra bước cơ bản = engine ghi + khoá ở đây + bỏ `pending` ở contracts (sổ module kiểm hai chiều).
 */
export const CORE_WRITTEN_OUTPUTS: Readonly<Record<string, readonly string[]>> = {
  "core.approve": ["decision", "decided_by", "feedback"],
  "core.email": ["sent_to"],
  "core.bell": ["sent_to"],
};

export function bindCoreNodes(registry: ModuleRegistry = moduleRegistry): string[] {
  const keys: string[] = [];
  for (const n of CORE_MODULE.nodes) {
    if (n.kind !== "base" || n.baseExecutor === undefined) continue;
    registry.bindNode({
      key: n.key,
      executor: n.baseExecutor,
      outputs: CORE_WRITTEN_OUTPUTS[n.key] ?? [],
    });
    keys.push(n.key);
  }
  return keys;
}
