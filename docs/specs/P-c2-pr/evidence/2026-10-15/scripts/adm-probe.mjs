import { launch, mkSnap, adminLogin, ADMIN } from "./lib.mjs";
import { OUT } from "./flow.mjs";
const D = await launch(OUT); const snap = mkSnap(OUT);
D.page.on("response", (r) => { if (/4000|process|engine/.test(r.url())) console.log(r.status(), r.url().slice(0, 120)); });
D.page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });
await adminLogin(D.page, "julian.bui", "evolu"); await D.page.waitForTimeout(3000);
await snap(D.page, "probe-admin-home");
console.log(await D.page.locator("nav").innerText());
await D.browser.close();
