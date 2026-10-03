// ADM-FR-40, ADM-FR-41, ADM-FR-42, ADM-FR-51, ADM-FR-52 · nhãn e2e khối A + B (test-plan-ab-e2e.md E1–E22; nguyên văn
// plan-frontend §6–7, admin-missing-screens §1, §4.3, §7) phải có làm giá trị trong vi.json. Không DB. Xanh ở FE4b.
// Nhãn có tham số (vd "Đã dùng 85% quota tháng này") khớp với giá trị có `{…}` (mỗi `{x}` = một đoạn bất kỳ, không rỗng).
// Nhãn là một phần của tên (Playwright khớp chuỗi con) khớp khi nằm trong một giá trị.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_modules";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const vi = (): string[] =>
  Object.values(
    flatten(JSON.parse(readFileSync(join(ROOT, "packages/i18n/locales/vi.json"), "utf8")) as Tree),
  );

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Giá trị i18n → regex khớp toàn bộ, `{x}` = `.+`. */
const pattern = (v: string) => new RegExp(`^${esc(v).replace(/\\\{[^}]*\\\}/g, ".+")}$`, "s");

function covered(label: string, values: readonly string[]): boolean {
  return values.some((v) => v.includes(label) || (v.includes("{") && pattern(v).test(label)));
}

/** Nhãn nguyên văn dùng trong e2e A + B (role name / text). */
const E2E_LABELS = [
  // E1–E4, E22 · Quota (tenant)
  "Quota",
  "Số run · Cả tenant",
  "Số USD · Kế toán",
  "+ Thêm quota theo feature",
  "Chọn feature",
  "Lưu",
  "Nhập số lớn hơn 0 hoặc để trống",
  "Tối đa 2 chữ số thập phân",
  "Nhập số nguyên",
  "Cả tenant",
  "Không giới hạn",
  "Bỏ quota Kế toán",
  "Có người vừa lưu bản mới hơn",
  // E5–E9 · Usage
  "Chi phí & quota",
  "Tenant",
  "Kỳ",
  "Số run",
  "Token",
  "Số thu",
  "Chi phí thật",
  "Biên",
  "Số thu theo ngày",
  "Theo tenant",
  "Top feature theo số thu",
  "Không theo feature",
  "Chưa định giá",
  "Vượt quota",
  "Xuất CSV",
  "Chưa có dữ liệu từ Agent Hub",
  // E10–E13 · Banner, Tổng quan
  "Đã dùng 85% quota tháng này",
  "Xem chi tiết",
  "Đang vượt quota, phần vượt được tính phí",
  "Users đang hoạt động",
  "Quota tháng",
  "Run",
  "Người dùng mới chưa đăng nhập",
  "Thay đổi gần đây",
  "Xem nhật ký",
  "Tạo tenant",
  "Tạo command",
  "Tenant sắp hoặc đã vượt quota",
  "Sẽ có khi Agent Hub sẵn sàng.",
  // E14–E21 · Nhật ký, khôi phục, conflict
  "Nhật ký",
  "Xem thay đổi",
  "đã đổi",
  "Đóng",
  "Khôi phục bản trước",
  "Khôi phục /dich về trạng thái trước v43?",
  "Khôi phục",
  "Đã khôi phục /dich · v44",
  "Không khôi phục được: /dich đã được dùng bởi command khác",
  "Giá trị: đã thay đổi",
  "Toàn hệ thống",
  "Không tìm thấy",
  "Tải thêm",
  "admin đã sửa command /dich",
  "Lịch sử vẫn giữ v42.",
];

describe("ADM-FR-40 · ADM-FR-42 · ADM-FR-51 · nhãn e2e M4 A + B", () => {
  it("ADM-FR-51 · tự kiểm bộ so khớp: '{x}' khớp đoạn bất kỳ, chuỗi con khớp, sai chữ không khớp", () => {
    expect(covered("Đã dùng 85% quota tháng này", ["Đã dùng {pct}% quota tháng này"])).toBe(true);
    expect(covered("Số thu theo ngày", ["Số thu theo ngày, tổng {total}"])).toBe(true);
    expect(covered("Đã dùng 85% quota tháng", ["Đã dùng {pct}% quota tháng này"])).toBe(false);
  });

  it("ADM-FR-40 · ADM-FR-41 · ADM-FR-42 · ADM-FR-51 · ADM-FR-52 · mọi nhãn e2e §3-E có làm giá trị trong vi.json", () => {
    const values = vi();
    expect(E2E_LABELS.filter((l) => !covered(l, values))).toEqual([]);
  });
});
