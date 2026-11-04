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
//   `ai` = chat AI thật nhưng CHỈ tạo/đọc hội thoại của chính nó (không ghi dữ liệu demo dùng chung, không xoá/sửa của spec khác): chạy
//          `--workers 2` SONG SONG với ro (ro 4 + ai 2). Hậu tố `NN-ten.ai.deployed.ts` hoặc danh sách AI_LEGACY. Spec chat có ghi dữ liệu chung ⇒ rw.
//   Spec cũ (trước quy tắc hậu tố) nằm trong RO_LEGACY / AI_LEGACY bên dưới; chỉ thêm vào đó khi đã phân loại.
// Playwright chỉ có `workers` toàn cục (không theo project) ⇒ runner `e2e-deployed.ps1` chạy hai lượt nối tiếp:
//   `--project ro --workers 4` song song `--project ai --workers 2` (hai tiến trình, outputDir riêng), rồi `--project rw --workers 1`. Chạy tay không cờ ⇒ workers=1 (DEP_WORKERS) ⇒ như cũ, an toàn.
// Giới hạn đăng nhập (admin-api limit.rules): tài khoản 5 sai liên tiếp ⇒ khoá 15 phút; IP 30 lượt / 10 phút (cả khi qua tunnel).
//   Ngân sách đăng nhập (ước từ mã): ro ~10 (1 sai có chủ đích) + ai ~12 (kể cả 2 đăng nhập admin của difyRuns) ≈ 22 lần CÙNG cửa sổ ⇒ ro+ai ≤ ~24;
//   spec mới nhiều đăng nhập ⇒ dùng chung một phiên hoặc đưa sang rw. rw (~15 đăng nhập) chạy SAU ro+ai: nếu ro+ai xong < 10 phút thì cửa sổ
//   có thể còn ~8 chỗ ⇒ runner ngủ phần còn thiếu tới 10 phút trước khi vào rw (-RwDelay; đặt 0 để bỏ).
const RO_LEGACY = [
  "01-login-sso",
  "07-usage",
  "14-app-perm-demo",
  "16-upload-quota-popup",
  "17-delivery-stock-409",
  "18-rep-switch-preview",
];
const AI_LEGACY = [
  "03-chat",
  "05-ai-tiers-rag",
  "06-guide",
  "08-my-activity",
  "12-han-muc-duyet",
  "13-chat-dify-tool",
];
const AI_MATCH = new RegExp(`((${AI_LEGACY.join("|")})\\.deployed\\.ts|\\.ai\\.deployed\\.ts)$`);
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
      name: "ai",
      testMatch: AI_MATCH,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "rw",
      testMatch: RW_MATCH,
      testIgnore: [RO_MATCH, AI_MATCH],
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
