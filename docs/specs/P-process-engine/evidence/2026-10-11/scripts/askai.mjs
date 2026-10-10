// Xác minh S1c: Hỏi AI !key — UI sau khi gửi (URL, composer, có thấy khối/flow?)
import { launch, ctx, snap, chatLogin, CHAT } from "./lib.mjs";
import { execFileSync } from "node:child_process";
const sql = (q) => execFileSync("docker", ["exec", "ai-system-postgres-1", "psql", "-U", "ai", "-d", "ai_system", "-Atc", q]).toString().trim();
const b = await launch(); const A = await ctx(b, { width: 1280, height: 900 });
await chatLogin(A.p, "lan");
await A.p.goto(`${CHAT}/c/new`);
const tb = A.p.getByRole("textbox").first(); await tb.fill("!hoa-don HD-104 3.000.000");
await A.p.keyboard.press("Enter");
for (const t of [1000, 5000, 15000]) { await A.p.waitForTimeout(t); console.log(t, A.p.url(), "| composer:", JSON.stringify(await tb.inputValue().catch(() => "?"))); }
await snap(A.p, "13b-L-askai-enter-20s");
console.log((await A.p.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 400));
console.log("runs có conversation:", sql("select status, origin_kind, conversation_id is not null from hub.process_runs order by started_at desc limit 1"));
await A.p.reload(); await A.p.waitForTimeout(3000); await snap(A.p, "13b-L-askai-enter-reload"); console.log("sau reload", A.p.url());
await b.close();
