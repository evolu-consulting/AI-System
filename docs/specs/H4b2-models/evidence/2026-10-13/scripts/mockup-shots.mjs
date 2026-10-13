import { chromium } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
const OUT = process.argv[2];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
for (const n of ["Provider-Sheet", "Check", "Runbook", "States"]) {
  await p.goto(`file:///D:/AI/ai-system/docs/design/agent-hub/canvas/H4b2-${n}.dc.html`); await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
}
await b.close();
