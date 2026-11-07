// CR-125 · m5 · MOD-FR-05 · binding bước cơ bản `core` (Duyệt, Nếu, Gửi email, Thông báo chuông, Kết thúc, Hẹn giờ, Chờ khoảng):
// GHI NHẬN executor lõi mà engine đã chạy sẵn (`approve|if|notify|set|wait_until|wait_for`) vào sổ module — KHÔNG đổi cách engine chạy.
// Danh sách node đọc từ `CORE_MODULE` (MỘT nguồn); thêm bước cơ bản = thêm khai báo ở contracts, không sửa file này.
import { CORE_MODULE } from "@ai/contracts/modules";
import { type ModuleRegistry, moduleRegistry } from "../../kit/public";

export function bindCoreNodes(registry: ModuleRegistry = moduleRegistry): string[] {
  const keys: string[] = [];
  for (const n of CORE_MODULE.nodes) {
    if (n.kind !== "base" || n.baseExecutor === undefined) continue;
    registry.bindNode({ key: n.key, executor: n.baseExecutor });
    keys.push(n.key);
  }
  return keys;
}
