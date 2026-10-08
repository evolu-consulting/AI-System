import { chromium } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import fs from "node:fs";
const OUT = "D:/AI/ai-system/docs/specs/CR-052/evidence/2026-10-08/";
const APPS = {
  admin: { name: "Evolu Control", url: "http://localhost:3000/login", t: "input[name=tenant_key]", u: "input[name=username]", p: "input[name=password]" },
  chat: { name: "Evolu Copilot", url: "http://localhost:3100/login", t: "input[name=tenant_key]", u: "input[name=username]", p: "input[name=password]" },
  studio: { name: "Agent Forge", url: "http://localhost:3200/studio/login", t: "#login-tenant", u: "#login-username", p: "#login-password" },
};
const res = [];
const rec = (s, app, ok, note, img = "") => { res.push({ s, app, ok, note, img }); console.log(ok ? "PASS" : "FAIL", s, app, String(note).slice(0, 1200), img); };
const b = await chromium.launch();
const ctx = (o = {}) => b.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 }, ...o });
const BAD = /dify|claude-sub|\bllm\b/i;
for (const [k, a] of Object.entries(APPS)) {
  let c = await ctx(), p = await c.newPage();
  await p.goto(a.url); await p.waitForTimeout(1200);
  const txt = await p.evaluate(() => document.documentElement.innerText + " " + document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, ""));
  const h1 = await p.locator("h1").first().innerText();
  const pressed = await p.getByRole("button", { name: "English" }).getAttribute("aria-pressed");
  const brandBox = await p.getByText(a.name, { exact: true }).first().boundingBox();
  await p.screenshot({ path: OUT + `01-${k}-login-en.png` });
  rec("S1", k, !BAD.test(txt) && pressed === "true" && /Sign in/.test(h1) && brandBox && brandBox.x < 200 && brandBox.y < 120, `h1="${h1}" pressed=${pressed} brand=${JSON.stringify(brandBox)} badText=${BAD.test(txt)} lang=${await p.evaluate(() => document.documentElement.lang)} title=${await p.title()}`, `01-${k}-login-en.png`);
  await p.getByRole("button", { name: "Tiếng Việt" }).click(); await p.waitForTimeout(500);
  const vh1 = await p.locator("h1").first().innerText();
  await p.screenshot({ path: OUT + `02-${k}-login-vi.png` });
  await p.reload(); await p.waitForTimeout(1000);
  const vh2 = await p.locator("h1").first().innerText();
  const ls = await p.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  await p.screenshot({ path: OUT + `02-${k}-login-vi-reload.png` });
  rec("S2", k, vh1 !== h1 && vh2 === vh1, `h1 after click="${vh1}", after reload="${vh2}" ls=${ls}`, `02-${k}-login-vi*.png`);
  await c.close();
  const notes = []; let ok3 = true;
  for (const [w, h] of [[1024, 768], [1366, 768], [375, 812]]) {
    c = await ctx({ viewport: { width: w, height: h } }); p = await c.newPage(); await p.goto(a.url); await p.waitForTimeout(1000);
    const m = await p.evaluate(() => {
      const d = document.documentElement;
      const over = [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).length;
      const aside = [...document.querySelectorAll("aside")].map((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0);
      return { sw: d.scrollWidth, iw: innerWidth, sh: d.scrollHeight, ih: innerHeight, over, aside };
    });
    const h1v = await p.locator("h1").first().isVisible(); const btn = await p.locator("button[type=submit]").isVisible();
    await p.screenshot({ path: OUT + `03-${k}-${w}x${h}.png` });
    if (!(m.sw <= m.iw && h1v && btn)) ok3 = false;
    notes.push(`${w}:${JSON.stringify(m)} form=${h1v && btn}`);
    await c.close();
  }
  rec("S3", k, ok3, notes.join(" | "), `03-${k}-*.png`);
  c = await ctx(); p = await c.newPage(); await p.goto(a.url); await p.waitForTimeout(800);
  const order = [];
  for (let i = 0; i < 10; i++) {
    await p.keyboard.press("Tab");
    const d = await p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return "body"; const cs = getComputedStyle(e); return `${e.tagName}:${e.getAttribute("aria-label") || e.name || e.id || e.textContent.trim().slice(0, 15)}|outline=${cs.outlineStyle}/${cs.outlineWidth}|shadow=${cs.boxShadow !== "none"}`; });
    order.push(d);
    if (i === 0) await p.screenshot({ path: OUT + `04-${k}-focus-first.png` });
    if (/BUTTON:Sign in/.test(d)) { await p.screenshot({ path: OUT + `04-${k}-focus-submit.png` }); break; }
  }
  rec("S4", k, order.some((x) => /English/.test(x)) && order.some((x) => /BUTTON:Sign in/.test(x)), order.join(" > "), `04-${k}-focus-*.png`);
  await c.close();
  c = await ctx(); p = await c.newPage(); await p.goto(a.url); await p.waitForTimeout(800);
  const user = k === "chat" ? ["evolu", "thomas.tran"] : ["platform", "admin"];
  await p.locator(a.t).fill(user[0]); await p.locator(a.u).fill(user[1]); await p.locator(a.p).fill("wrongpassword1");
  await p.locator("button[type=submit]").click(); await p.waitForTimeout(1800);
  const alertTxt = await p.locator("[role=alert]").allInnerTexts();
  await p.screenshot({ path: OUT + `05-${k}-wrong-pw.png` });
  rec("S5a", k, alertTxt.join("").length > 0, `alert=${JSON.stringify(alertTxt)}`, `05-${k}-wrong-pw.png`);
  const resp = [];
  p.on("response", async (r) => { if (/auth|\/me\b/.test(r.url()) && r.request().method() !== "OPTIONS") { try { resp.push(r.url() + " " + r.status() + " " + (await r.text()).slice(0, 400)); } catch {} } });
  await p.locator(a.p).fill("1234567890"); await p.locator("button[type=submit]").click(); await p.waitForTimeout(3500);
  const url = p.url();
  const bodyT = (await p.locator("body").innerText()).slice(0, 200);
  await p.screenshot({ path: OUT + `05-${k}-after-login.png` });
  const ls2 = await p.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  rec("S5b", k, !/login/.test(url), `url=${url} lang=${await p.evaluate(() => document.documentElement.lang)} title=${await p.title()} ls=${ls2} resp=${resp.join(" ## ").slice(0, 900)} body=${JSON.stringify(bodyT)}`, `05-${k}-after-login.png`);
  await c.close();
  c = await ctx({ colorScheme: "dark" }); p = await c.newPage(); await p.goto(a.url); await p.waitForTimeout(1000);
  await p.screenshot({ path: OUT + `08-${k}-dark.png` }); rec("S8", k, true, "visual review", `08-${k}-dark.png`); await c.close();
}
async function login(a, t, u) { const c = await ctx(); const p = await c.newPage(); await p.goto(a.url); await p.waitForTimeout(800); await p.locator(a.t).fill(t); await p.locator(a.u).fill(u); await p.locator(a.p).fill("1234567890"); await p.locator("button[type=submit]").click(); await p.waitForTimeout(3500); return [c, p]; }
const links = (p) => p.locator("a").evaluateAll((l) => l.map((a) => a.textContent.trim() + "->" + a.href));
let [c, p] = await login(APPS.admin, "evolu", "thomas.tran");
await p.screenshot({ path: OUT + "06-admin-member.png" });
rec("S6a", "admin", true, `url=${p.url()} body=${JSON.stringify((await p.locator("body").innerText()).slice(0, 400))} links=${JSON.stringify(await links(p))}`, "06-admin-member.png"); await c.close();
[c, p] = await login(APPS.studio, "evolu", "julian.bui");
await p.screenshot({ path: OUT + "06-studio-nonplatform.png" });
rec("S6b", "studio", true, `url=${p.url()} body=${JSON.stringify((await p.locator("body").innerText()).slice(0, 500))} alert=${JSON.stringify(await p.locator("[role=alert]").allInnerTexts())} links=${JSON.stringify(await links(p))}`, "06-studio-nonplatform.png"); await c.close();
for (const [k, t, u] of [["admin", "platform", "admin"], ["studio", "platform", "admin"], ["chat", "evolu", "thomas.tran"]]) {
  [c, p] = await login(APPS[k], t, u);
  const info = { url: p.url(), title: await p.title(), top: (await p.locator("body").innerText()).slice(0, 500), links: await p.locator("a,button").evaluateAll((l) => l.map((a) => (a.textContent || "").trim().slice(0, 25) + (a.href ? "->" + a.href : "")).filter((x) => x).slice(0, 30)) };
  await p.screenshot({ path: OUT + `07-${k}-names.png` }); rec("S7", k, true, JSON.stringify(info), `07-${k}-names.png`);
  await c.close();
  c = await ctx({ colorScheme: "dark" }); const q = await c.newPage(); await q.goto(APPS[k].url); await q.waitForTimeout(500);
  await q.locator(APPS[k].t).fill(t); await q.locator(APPS[k].u).fill(u); await q.locator(APPS[k].p).fill("1234567890"); await q.locator("button[type=submit]").click(); await q.waitForTimeout(3500);
  await q.screenshot({ path: OUT + `08-${k}-app-dark.png` }); await c.close();
}
fs.writeFileSync(OUT + "result.json", JSON.stringify(res, null, 1));
await b.close();
