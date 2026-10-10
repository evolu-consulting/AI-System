// CHAT-AC-51 · CHAT-AC-52 · e2e P-a PF1 · E-P1, E-P2 (test-plan-e2e §2): menu `!` ở composer phòng — chỉ quy trình mình được
// chạy (`hoa-don-t` giới hạn Group "Chạy hoá đơn" = A, B; X không thấy), lọc, chèn "!key ", `@` vẫn menu Agent, `/` là chữ;
// nút "Quy trình"; key sai ⇒ alert + gợi ý, chữ giữ, phòng không thêm tin. Nhãn: plan-frontend-e2e §1.
import { expect, test } from "@playwright/test";
import {
  block,
  hub,
  mkRoom,
  processBtn,
  processMenu,
  roomBox,
  roomLog,
  settle,
  tok,
  users,
} from "../_pa-support";

test.afterEach(() => settle());

test('CHAT-AC-51 · E-P1 · gõ "!" ⇒ listbox "Quy trình" chỉ quy trình A được chạy; "!hoa" lọc; Enter ⇒ ô "!hoa-don-t "; X không thấy hoa-don-t; "@" vẫn menu Agent; "/" là chữ', async ({
  browser,
}) => {
  const room = await mkRoom("EP1");
  const u = await users(browser, "A", "X");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    await roomBox(u.A).fill("!");
    const menu = processMenu(u.A);
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Quy trình bạn được chạy · gõ tiếp để lọc");
    const opt = menu.getByRole("option").filter({ hasText: "!hoa-don-t" });
    await expect(opt).toContainText("2 giai đoạn");
    await roomBox(u.A).fill("!hoa-don-t"); // "!hoa" còn khớp mẫu seed `hoa-don` của acme
    await expect(menu.getByRole("option")).toHaveCount(1);
    await roomBox(u.A).press("Enter");
    await expect(roomBox(u.A)).toHaveValue("!hoa-don-t ");
    await roomBox(u.A).fill("@");
    await expect(u.A.getByRole("listbox", { name: "Agent" })).toBeVisible();
    await expect(processMenu(u.A)).toBeHidden();
    await roomBox(u.A).fill("/");
    await expect(processMenu(u.A)).toBeHidden();
    await expect(roomBox(u.A)).toHaveValue("/");

    await u.X.goto(`/rooms/${room.id}`);
    await roomBox(u.X).fill("!");
    await expect(processMenu(u.X)).toBeVisible();
    await expect(
      processMenu(u.X).getByRole("option").filter({ hasText: "!hoa-don-t" }),
    ).toHaveCount(0);
  } finally {
    await u.close();
  }
});

test('CHAT-AC-51 · CHAT-AC-52 · E-P2 · nút "Quy trình" mở menu như "!"; "!sai-key abc" ⇒ alert "Không tìm thấy quy trình “!sai-key”." + gợi ý, chữ giữ, phòng không thêm tin/khối', async ({
  browser,
}) => {
  const room = await mkRoom("EP2");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    await expect(processBtn(u.A)).toHaveAttribute("aria-haspopup", "listbox");
    await processBtn(u.A).click();
    await expect(processMenu(u.A)).toBeVisible();
    await expect(processBtn(u.A)).toHaveAttribute("aria-expanded", "true");
    await u.A.keyboard.press("Escape");

    const before =
      (await hub(await tok("A"), "GET", `/rooms/${room.id}/messages?limit=100`)).json?.items
        ?.length ?? 0;
    await roomBox(u.A).fill("!sai-key abc");
    await u.A.getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(
      u.A.getByRole("alert").filter({ hasText: "Không tìm thấy quy trình “!sai-key”." }),
    ).toBeVisible();
    await expect(u.A.getByText("Ý bạn là:")).toBeVisible();
    await expect(roomBox(u.A)).toHaveValue("!sai-key abc");
    await expect(block(u.A)).toHaveCount(0);
    const after =
      (await hub(await tok("A"), "GET", `/rooms/${room.id}/messages?limit=100`)).json?.items
        ?.length ?? 0;
    expect(after).toBe(before);
    await expect(roomLog(u.A).getByRole("article").filter({ hasText: "!sai-key abc" })).toHaveCount(
      0,
    );
    // gần đúng ⇒ "Ý bạn là:" có `button "!hoa-don-t"`; bấm ⇒ ô đổi key
    await roomBox(u.A).fill("!hoa-don-x HD-1");
    await u.A.getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(
      u.A.getByRole("alert").filter({ hasText: "Không tìm thấy quy trình “!hoa-don-x”." }),
    ).toBeVisible();
    await u.A.getByRole("button", { name: "!hoa-don-t", exact: true }).click();
    await expect(roomBox(u.A)).toHaveValue(/^!hoa-don-t /);
  } finally {
    await u.close();
  }
});
