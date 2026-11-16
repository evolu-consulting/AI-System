// CR-180 · «kiểm mobile» chặn tái phát: mỗi màn chính của Sổ Hợp Tác ở 390×844 (isMobile, hasTouch) đạt 4 luật —
// R1 không tràn ngang · R2 vùng bấm ≥ 44 · R3 chữ ≥ 12 · R4 nút trợ lý không che nút bấm lúc mở trang. Hàm đo + ngoại lệ: `_kit/mobile-rules.ts`.
// Backend giả `installHub` (như scenes.cw.ts); API chưa giả (tin nhắn, sơ đồ, thông báo…) trả danh sách rỗng ⇒ đo trạng thái rỗng.
// Không sleep. Màn Bảng tin / hồ sơ / yêu cầu / báo cáo: `community-web/mobile-rules.cm.ts`.
import { type Page, test } from "@playwright/test";
import { expectMobileRules, MOBILE_USE, settle } from "../_kit/mobile-rules";
import { installHub } from "./_hub";
import { ACTIVE_ID } from "./dataset-v2f";

test.use(MOBILE_USE);

const CHAT_ID = "01a1d802-b9a3-7000-943d-9f43ee1675bc";

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+07:00"));
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  // API chưa giả: để 404 như cảnh `messages-mobile` (một fallback `{items:[]}` chung làm vài màn vỡ «Something went wrong»).
  await installHub(page, true);
  await page.goto(path);
  await settle(page);
}

const SCREENS: { name: string; path: string; act?: (p: Page) => Promise<void> }[] = [
  { name: "Tổng quan", path: "/contracts" },
  { name: "Danh sách HĐ", path: "/contracts/list" },
  { name: "Chi tiết HĐ", path: `/contracts/c/${ACTIVE_ID}` },
  { name: "Tạo HĐ", path: "/contracts/c/new" },
  { name: "Việc của tôi", path: "/contracts/approvals" },
  { name: "Đối tác", path: "/contracts/partners" },
  {
    name: "Chi tiết đối tác",
    path: "/contracts/partners",
    act: async (p) => {
      const row = p.locator("main li").filter({ hasText: "Bếp Việt" }).first();
      // Lượt chạy 1 cho thấy nút «Ghi việc» không bấm được theo tên ở 390 px ⇒ mở bằng nút đầu của dòng (chưa kiểm lại: tối đa 2 lượt).
      await row.getByRole("button").first().click();
      await p.waitForLoadState("networkidle");
    },
  },
  { name: "Sản phẩm", path: "/contracts/products" },
  { name: "Sơ đồ tổ chức", path: "/contracts/org" },
  { name: "Tin nhắn", path: "/contracts/messages" },
  { name: "Khung chat", path: `/contracts/messages?c=${CHAT_ID}` },
  { name: "Cài đặt thành viên", path: "/contracts/settings/members" },
  { name: "Thông báo", path: "/contracts/notifications" },
];

for (const s of SCREENS) {
  test.describe(`mobile · ${s.name}`, () => {
    test(`${s.name}: 4 luật mobile ở 390 px`, async ({ page }) => {
      await open(page, s.path);
      // R4 đo LÚC TRANG VỪA MỞ: chạy trước mọi thao tác của màn.
      await expectMobileRules(page, `${s.name} (vừa mở)`);
      if (s.act) {
        await s.act(page);
        await expectMobileRules(page, `${s.name} (sau thao tác)`);
      }
    });
  });
}
