// Xác minh: khối quy trình trong phòng có hiện trạng thái khi mới mở phòng, và sau khi mở thread?
import { launch, ctx, snap, chatLogin, CHAT, roomLog } from "./lib.mjs";
const R1 = process.argv[2];
const b = await launch(); const H = await ctx(b, { width: 1280, height: 900 });
await chatLogin(H.p, "hoa");
await H.p.goto(`${CHAT}/rooms/${R1}`); await H.p.waitForTimeout(6000);
const blk = () => roomLog(H.p).getByRole("article", { name: "Quy trình Xử lý hoá đơn" }).first();
console.log("TRƯỚC:", (await blk().innerText()).replace(/\s+/g, " ").slice(0, 160)); await snap(H.p, "12-H-block-before-thread");
await blk().getByRole("button", { name: "Trả lời tiếp" }).click(); await H.p.waitForTimeout(3000);
console.log("SAU  :", (await blk().innerText()).replace(/\s+/g, " ").slice(0, 160)); await snap(H.p, "12-H-block-after-thread");
await b.close();
