// UAT H4b-2 phần D: người không phải platform_admin (tenant_admin julian.bui, member thomas.tran của evolu) vào Studio Models/Quyền agent
import { launch, storage, studioLogin, mkSnap, mkStep, expect } from "./lib.mjs";
import { token, api } from "./api.mjs";
const OUT = process.argv[2];
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
const roles = [["julian.bui", "tenant_admin"], ["thomas.tran", "member"]];
let n = 0;
for (const [user, role] of roles) {
  await step(`D${++n}`, `${role} (${user}@evolu): API /studio/api/{providers,model-profiles,agent-entitlements,secrets} ⇒ 403; ghi cũng 403`, async () => {
    const t = await token(user, "evolu", "1234567890");
    for (const p of ["/providers", "/model-profiles", "/agent-entitlements"]) {
      const r = await api(t, "GET", p);
      if (r.status !== 403) throw new Error(`${p} => ${r.status}`);
    }
    const w = await api(t, "POST", "/providers", { key: "uat-hack", kind: "subscription", vendor: "fake" });
    if (w.status !== 403) throw new Error(`POST /providers => ${w.status}`);
    const w2 = await api(t, "PUT", "/agent-entitlements/7c34267d-c4ee-4b2a-9f0d-1586bed0098e/01a11c1d-ca4e-7000-b4eb-212defbb548f");
    if (w2.status !== 403) throw new Error(`PUT entitlement => ${w2.status}`);
  });
  await step(`D${++n}`, `${role}: đăng nhập Studio rồi vào /studio/models và /studio/access`, async () => {
    const ctx2 = await browser.newContext({ locale: "vi-VN", viewport: { width: 1280, height: 800 }, storageState: storage("vi") });
    const ctxPage = await ctx2.newPage();
    await ctxPage.goto("http://localhost:3200/studio/login");
    await ctxPage.getByRole("textbox", { name: "Mã công ty" }).fill("evolu");
    await ctxPage.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
    await ctxPage.getByRole("textbox", { name: "Mật khẩu" }).fill("1234567890");
    await ctxPage.getByRole("button", { name: "Đăng nhập" }).click();
    await ctxPage.waitForTimeout(2500);
    await snap(ctxPage, `${String(n).padStart(2, "0")}-D-${user}-after-login`, true);
    const nav = ctxPage.getByRole("navigation", { name: "Menu Studio" });
    const hasNav = await nav.count();
    console.log(user, "url sau login:", ctxPage.url(), "| có menu Studio:", hasNav);
    if (hasNav) {
      for (const l of ["Models", "Quyền agent"]) if (await nav.getByRole("link", { name: l }).count()) throw new Error(`menu "${l}" vẫn hiện cho ${role}`);
    }
    for (const path of ["models", "access"]) {
      await ctxPage.goto(`http://localhost:3200/studio/${path}`);
      await ctxPage.waitForTimeout(1500);
      console.log(user, path, "->", ctxPage.url());
      await snap(ctxPage, `${String(n).padStart(2, "0")}-D-${user}-${path}`, true);
      const body = await ctxPage.locator("body").innerText();
      if (/Danh sách provider|Ma trận quyền agent/.test(body)) throw new Error(`${path} lộ dữ liệu cho ${role}`);
    }
    await ctx2.close();
  });
}
save();
await browser.close();
