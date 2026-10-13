import { chromium } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
for (const n of ["Editor", "Diff", "Decision"]) {
  await p.goto(`file:///D:/AI/ai-system/docs/design/agent-hub/canvas/Pc-${n}.dc.html`); await p.waitForTimeout(1500);
  await p.screenshot({ path: `D:/AI/ai-system/docs/specs/P-c-autofix/evidence/2026-10-14/mockup/Pc-${n}.png`, fullPage: true });
}
await b.close();
