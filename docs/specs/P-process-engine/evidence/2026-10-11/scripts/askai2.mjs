import { launch, ctx, chatLogin, CHAT } from "./lib.mjs";
const b = await launch();
for (const mode of ["button", "enter"]) {
  const A = await ctx(b, { width: 1280, height: 900 }); await chatLogin(A.p, "lan");
  A.p.on("request", (r) => { if (r.method() === "POST" && !r.url().includes("auth")) console.log(mode, "POST", new URL(r.url()).pathname, (r.postData() || "").slice(0, 250)); });
  await A.p.goto(`${CHAT}/c/new`); const tb = A.p.getByRole("textbox").first(); await tb.fill("!hoa-don HD-105 1.000");
  if (mode === "button") await A.p.getByRole("button", { name: "Gửi", exact: true }).click(); else await A.p.keyboard.press("Enter");
  await A.p.waitForTimeout(5000); console.log(mode, "url", A.p.url());
  await A.p.close();
}
await b.close();
