import { launch, chatLogin, mkSnap, CHAT } from "./lib.mjs";
const [OUT, run, name] = process.argv.slice(2);
const { browser, page } = await launch(OUT);
await chatLogin(page, "thomas.tran");
await page.goto(`${CHAT}/runs/${run}`); await page.waitForTimeout(3000);
await mkSnap(OUT)(page, name, true);
console.log("notices:", await page.getByText(/Tri thức: \d+\/5 lần hỏi/).count());
await browser.close();
