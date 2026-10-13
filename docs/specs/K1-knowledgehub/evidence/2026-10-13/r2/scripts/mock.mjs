import { chromium } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
const OUT = process.argv[2];
const D = "C:/Users/MSI VN/AppData/Local/Temp/claude/D--AI-ai-system/6c6a173e-086a-444f-8235-a283b954cab3/scratchpad/k1mock/project/";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
for (const n of ["Main", "Sheet", "Agent", "Check"]) {
  await p.goto("file:///" + D + n + ".dc.html"); await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/mock-${n}.png`, fullPage: true });
  console.log(n, (await p.locator("body").innerText()).slice(0, 200).replace(/\n+/g, " | "));
}
await b.close();
