// CR-189 · BR-189-2/3 · thẻ phòng trên Sơ đồ tổ chức + «Danh sách avatar»: thẻ có tên phòng, trưởng phòng, «N người · tổng M»,
// hàng avatar nhân viên (≤ 5 + «+n»); bấm ⇒ danh sách họ tên + chức vụ, Esc đóng, > 8 người cuộn.
// Backend giả bằng `page.route`. CHƯA chạy lúc viết (điều phối chạy cuối đợt).
import { expect, test } from "@playwright/test";
import { asHub } from "./dataset";

test.skip(process.env.CW_MODE === "ref", "chế độ chụp tham chiếu mgmt-app");

const uid = (n: number) => `a9000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const person = (n: number) => ({ id: uid(n), name: `Người ${n}`, job_title: `Chức vụ ${n}` });
const G_ROOT = uid(0x100);
const G_KD = uid(0x101);
const DEPTS = [
  { id: G_ROOT, name: "Ban Giám đốc", parent_id: null, head: person(1), members: [person(1)] },
  // 9 nhân viên + trưởng phòng (người 2): > 8 ⇒ danh sách cuộn; thẻ hiện 5 avatar + «+4»
  {
    id: G_KD,
    name: "Kinh doanh",
    parent_id: G_ROOT,
    head: person(2),
    members: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(person),
  },
];

test("thẻ phòng hiện trưởng phòng và số người, bấm nhóm avatar mở danh sách họ tên chức vụ", async ({
  page,
}) => {
  const d = asHub("editor");
  await page.route("**/auth/refresh", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d.grant) }),
  );
  await page.route("**/pack/contracts/me", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d.packMe) }),
  );
  await page.route("**/pack/contracts/org", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ departments: DEPTS }),
    }),
  );
  await page.goto("/contracts/org");
  // phòng cha: trực tiếp 1 (trưởng phòng) + tổng 11 người
  const root = page.getByTestId(`org-node-${G_ROOT}`);
  await expect(root).toContainText("Người 1");
  await expect(root.getByTestId("org-count")).toContainText(/1 người\s*·\s*tổng 11/);
  // phòng lá: 10 người trực tiếp, không «tổng»
  const kd = page.getByTestId(`org-node-${G_KD}`);
  await expect(kd.getByTestId("org-count")).toHaveText(/^10 người$/);
  const group = kd.getByTestId("org-card-avatars");
  await expect(group).toBeVisible();
  // hàng avatar không gồm trưởng phòng: 9 nhân viên ⇒ 5 avatar + «+4»
  await expect(group.locator("[data-slot=avatar-group] > span")).toHaveCount(6, { timeout: 5000 });
  await group.click();
  const list = page.locator("[data-slot=avatar-list]");
  await expect(list).toBeVisible();
  await expect(list.locator("[data-slot=avatar-list-row]")).toHaveCount(9);
  await expect(list.locator("[data-slot=avatar-list-row]").first()).toContainText("Chức vụ 3");
  await expect(list).toHaveAttribute("data-scroll", "true");
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(group).toBeFocused();
});
