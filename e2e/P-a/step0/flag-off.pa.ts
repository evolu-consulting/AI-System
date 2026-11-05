// D15 · HUB-FR-104…117 (cờ) · e2e P-a Bước 0 · E-P16 (test-plan-e2e §2; plan-frontend-e2e §1–§2): cờ `HUB_PROCESS_ENGINE`.
// Một ca, rẽ theo cờ của stack (config truyền `HUB_PROCESS_ENGINE`, mặc định `on`):
//  · `off` (`HUB_PROCESS_ENGINE=off bunx playwright test -c e2e/P-a/playwright.pa.config.ts --project=step0`): mọi lối vào quy
//    trình ẩn — không `button "Quy trình"`, gõ `!` không `listbox "Quy trình"`, không "Chờ tôi kiểm", không `link "Quy trình"`
//    (chat + admin), `/runs/<id>` và `/process-inbox` ⇒ "Không tìm thấy", Hub `GET /processes` 404; `!hoa-don-t x` gửi như chữ
//    (201, không `X-Process-Run-Id`); X2b vẫn chạy (`@hd-read` ⇒ `X-Run-Id`). Trước code phần "ẩn" xanh do vắng (chủ ý, như S0-10).
//  · `on` (lần chạy thường): đối chứng — cùng các lối vào PHẢI có (nút, menu, "Chờ tôi kiểm", DM, nav admin, `GET /processes` 200)
//    ⇒ ca đỏ tới khi PF1/PF3/PF4 có; đây là vế bảo đảm khác biệt on/off kiểm được (không xanh hiển nhiên).
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  adminLogin,
  hub,
  mkRoom,
  processBtn,
  processMenu,
  roomBox,
  sendRoom,
  settle,
  tok,
  users,
} from "../_pa-support";

test.afterEach(() => settle());

// biome-ignore lint/suspicious/noUndeclaredEnvVars: cờ stack e2e (config truyền xuống hub-api)
const ON = (process.env.HUB_PROCESS_ENGINE ?? "on") !== "off";

test(`D15 · E-P16 · cờ ${ON ? "on (đối chứng)" : "off"}: lối vào quy trình ở chat-web + admin-web ${ON ? "có" : "ẩn"}; !key ${ON ? "tạo run" : "là chữ"}; X2b @agent vẫn chạy`, async ({
  browser,
}) => {
  const room = await mkRoom("EP16");
  const u = await users(browser, "A");
  const adm = await browser.newContext();
  try {
    const p = u.A;
    // Hub: danh mục quy trình theo cờ
    const list = await hub(await tok("A"), "GET", "/processes");
    expect(list.status).toBe(ON ? 200 : 404);

    // composer phòng: nút + menu `!`
    await p.goto(`/rooms/${room.id}`);
    await expect(roomBox(p)).toBeVisible();
    await expect(processBtn(p)).toHaveCount(ON ? 1 : 0, { timeout: ON ? 10_000 : 2_000 });
    await roomBox(p).fill("!");
    if (ON) await expect(processMenu(p)).toBeVisible();
    else await expect(processMenu(p)).toHaveCount(0);

    // sidebar "Chờ tôi kiểm" + DM "Quy trình"
    await expect(p.getByRole("button", { name: "Chờ tôi kiểm" })).toHaveCount(ON ? 1 : 0);
    await expect(p.getByRole("link", { name: "Quy trình", exact: true })).toHaveCount(ON ? 1 : 0);

    // `!key` ở phòng: off ⇒ chữ thường (201, không header run), on ⇒ có `X-Process-Run-Id`
    await roomBox(p).fill("");
    const s = await sendRoom(p, "!hoa-don-t HD-16");
    expect(s.status).toBe(201);
    if (ON) expect(s.processRunId, "cờ on: `!key` phải tạo run").toBeTruthy();
    else {
      expect(s.processRunId).toBeNull();
      await expect(
        p.getByRole("log", { name: "Tin nhắn của phòng" }).getByText("!hoa-don-t HD-16"),
      ).toBeVisible();
    }

    // X2b không đổi: tag agent ⇒ run thường
    const x2b = await hub(await tok("A"), "POST", `/rooms/${room.id}/messages`, {
      client_msg_id: randomUUID(),
      content: "@hd-read kiểm tra HD-16",
    });
    expect(x2b.status).toBe(201);

    // route quy trình ở chat-web
    if (!ON) {
      for (const path of [`/runs/${randomUUID()}`, "/process-inbox"]) {
        await p.goto(path);
        await expect(p.getByText("Không tìm thấy").first()).toBeVisible();
      }
    }

    // admin-web: nav "Quy trình" theo cờ
    const ap = await adm.newPage();
    await adminLogin(ap);
    await expect(ap.getByRole("link", { name: "Tổng quan" }).first()).toBeVisible();
    await expect(ap.getByRole("link", { name: "Quy trình", exact: true })).toHaveCount(ON ? 1 : 0);
  } finally {
    await adm.close();
    await u.close();
  }
});
