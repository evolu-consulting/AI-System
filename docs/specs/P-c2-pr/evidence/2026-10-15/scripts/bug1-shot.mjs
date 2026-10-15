import { launch, mkSnap, chatLogin } from "./lib.mjs";
import { OUT } from "./flow.mjs";
const A = await launch(OUT); const snap = mkSnap(OUT);
await chatLogin(A.page, "thomas.tran");
await A.page.goto(`http://localhost:3100/runs/${process.argv[2]}`); await A.page.waitForTimeout(3000);
await snap(A.page, "BUG1-A-run-ket-o-running", true);
await A.browser.close();
