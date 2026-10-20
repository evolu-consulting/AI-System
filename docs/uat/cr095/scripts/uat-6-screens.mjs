// UAT CR-095 · phan 6: man hinh then chot sang/toi x desktop/mobile + kiem tra tran ngang.
import { browser, userPage, snap, step, ok, settle, CW, apiTok, hub } from "./lib.mjs";
const b = await browser(); const tk = await apiTok("chu");
const tp = (await hub(tk, "GET", "/contracts?page=1&page_size=100")).j.items.find((x) => x.number === "TP-03");
const pages = [["list", "/contracts"], ["detail", "/contracts/" + tp.id], ["partners", "/partners"], ["prices", "/prices"], ["cks", "/cks"], ["mywork", "/my-work"], ["sourcing", "/sourcing"], ["scoring", "/settings/scoring"], ["new", "/contracts/new"]];
const { p, done } = await userPage(b, "chu");
const modes = [["light-desktop", false, 1440, 900], ["dark-desktop", true, 1440, 900], ["light-mobile", false, 390, 844], ["dark-mobile", true, 390, 844]];
for (const [name, path] of pages) {
  await step(`Màn hình ${name}: sáng/tối × desktop/di động (không tràn ngang)`, "chu", async () => {
    const ev = []; const bad = [];
    for (const [m, dark, w, h] of modes) {
      await p.setViewportSize({ width: w, height: h }); await p.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await p.evaluate((d) => { try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, dark);
      await p.goto(CW + path); await p.evaluate((d) => { document.documentElement.dataset.theme = d ? "dark" : "light"; }, dark); await settle(p, 1500); if (dark) { const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor); const m = bg.match(/\d+/g).map(Number); if (m[0] > 120) bad.push(`${name}/${m0}: nền tối không áp dụng (${bg})`.replace("${m0}", "")); } ev.push(await snap(p, `30-${name}-${m}`));
      const ov = await p.evaluate(() => { const de = document.documentElement; return de.scrollWidth - de.clientWidth; }); if (ov > 1) bad.push(`${m}: tràn ngang ${ov}px`);
    }
    ok(!bad.length, bad.join("; ")); return { evidence: ev.join(", ") }; }, p);
}
await done(); await b.close();