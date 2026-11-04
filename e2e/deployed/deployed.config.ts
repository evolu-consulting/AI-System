// CR-095 · e2e TRIỂN KHAI: chạy với stack production `sohoptac2` (tenant demo, dữ liệu giả) qua SSH tunnel do runner mở
// (`deploy/prod-sohoptac2/e2e-deployed.ps1` → `bun run e2e:deployed`). Không webServer, không mock. Tên file KHÔNG khớp
// `playwright*.config.ts` ⇒ `test:all` không tự nhận (cần tunnel + mật khẩu demo). Web chia theo CỔNG (cùng host localhost
// ⇒ cookie refresh dùng chung giữa các web ⇒ SSO); không cần host-resolver-rules.
import { defineConfig, devices } from "@playwright/test";

// ---- Hai project: `ro` (song song) và `rw` (nối tiếp) — tool-deployed-par ----
// Quy tắc chọn project cho spec MỚI (không chắc ⇒ rw):
//   `ro` = CHỈ ĐỌC: đăng nhập / điều hướng / kiểm trang, API chỉ GET, hoặc mọi ghi đều bị route giả trong trình duyệt;
//          KHÔNG ghi dữ liệu demo dùng chung, KHÔNG gọi AI thật (chat/agent/Dify), KHÔNG đổi quyền/cài đặt, KHÔNG tải tệp thật.
//          Đặt tên `NN-ten.ro.deployed.ts` (hậu tố `.ro.deployed.ts`) ⇒ tự vào `ro`. Mỗi test độc lập (song song, thứ tự bất kỳ).
//   `rw` = mọi thứ còn lại (`NN-ten.deployed.ts`): ghi/xoá dữ liệu, bật tắt quyền, gửi góp ý, chat AI thật, phụ thuộc thứ tự.
//   Spec cũ (trước quy tắc hậu tố) nằm trong RO_LEGACY bên dưới; chỉ thêm vào đó khi đã phân loại ro.
// Playwright chỉ có `workers` toàn cục (không theo project) ⇒ runner `e2e-deployed.ps1` chạy hai lượt nối tiếp:
//   `--project ro --workers 4` rồi `--project rw --workers 1`. Chạy tay không cờ ⇒ workers=1 (DEP_WORKERS) ⇒ như cũ, an toàn.
// Giới hạn đăng nhập (admin-api limit.rules): tài khoản 5 sai liên tiếp ⇒ khoá 15 phút; IP 30 lượt / 10 phút (cả khi qua tunnel).
//   ro hiện ~10 đăng nhập (1 sai có chủ đích, 01-login-sso) ⇒ giữ ro ≤ ~12 đăng nhập; spec ro nhiều đăng nhập hơn ⇒ dùng chung một
//   phiên hoặc đưa sang rw. rw chạy SAU ro nên hai lượt không cộng dồn trong cùng cửa sổ 10 phút nếu ro ngắn; không chạy song song.
const RO_LEGACY = [
  "01-login-sso",
  "07-usage",
  "14-app-perm-demo",
  "16-upload-quota-popup",
  "17-delivery-stock-409",
  "18-rep-switch-preview",
];
const RO_MATCH = new RegExp(`((${RO_LEGACY.join("|")})\\.deployed\\.ts|\\.ro\\.deployed\\.ts)$`);
const RW_MATCH = /\.deployed\.ts$/;

export default defineConfig({
  testDir: ".",
  workers: Number(process.env.DEP_WORKERS ?? 1),
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  timeout: 360_000, // chat AI thật (gói Claude) có thể chậm
  expect: { timeout: 15_000 },
  outputDir: "../../test-results/deployed",
  use: {
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "ro",
      testMatch: RO_MATCH,
      fullyParallel: true,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "rw",
      testMatch: RW_MATCH,
      testIgnore: RO_MATCH,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
