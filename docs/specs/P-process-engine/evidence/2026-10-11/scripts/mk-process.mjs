// UAT: tenant_admin tạo quy trình tối thiểu `uat` qua editor admin-web (stage không đòi mục bắt buộc vì fake-cli chỉ echo).
import { OUT, launch, ctx, snap, adminLogin, ADMIN } from "./lib.mjs";
const b = await launch(); const { p } = await ctx(b, {width:1280,height:1100});
await adminLogin(p, "acme", "tadmin", "Uat-pass-12345");
await p.goto(`${ADMIN}/processes/new`); await p.waitForTimeout(1500);
await p.locator("#pd-name").fill("UAT Duyệt nhanh"); await p.locator("#pd-key").fill("uat");
await p.locator("#pd-desc").fill("Quy trình UAT tối thiểu (fake-cli, không mục bắt buộc)."); await p.locator("#pd-hint").fill("Nội dung cần soạn");
const stage = async (i, name, key, after) => {
  const s = (x) => `#s${i}-${x}`;
  await p.locator(s("name")).fill(name); await p.locator(s("key")).fill(key);
  await p.locator(s("exec")).click(); await p.getByRole("option", { name: "Đọc hoá đơn" }).first().click();
  await p.locator(s("instr")).fill("Soạn nội dung theo yêu cầu."); await p.locator(s("file")).fill(`${key}.md`);
  if (after) { await p.locator(s("after")).click(); await p.getByRole("option", { name: "Duyệt bởi Group" }).click(); await p.locator(s("group")).click(); await p.getByRole("option", { name: "Kế toán" }).click(); }
};
await stage(2, "Soạn", "soan", true);
await p.getByRole("button", { name: "Thêm giai đoạn" }).click(); await p.waitForTimeout(500);

await stage(3, "Hoàn tất", "xong", false);
await p.locator("#pd-enabled").click();
await snap(p, "x-new2");
await p.getByRole("button", { name: "Lưu", exact: true }).click(); await p.waitForTimeout(1500); await snap(p, "x-new3"); await p.screenshot({path:`${OUT}/x-new3-full.png`, fullPage:true}); console.log(await p.locator("[role=alert],[aria-invalid=true],.text-destructive,[data-sonner-toast]").allInnerTexts());
await b.close();
