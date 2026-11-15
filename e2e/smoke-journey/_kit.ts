// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến của runner deploy/smoke/smoke-journey.ps1
// CR-159 · bộ chung của bài kiểm hành trình: cấu hình từ môi trường, đăng nhập, bộ ghi bước (Đạt / Không đạt / Bỏ qua + ảnh chụp), PDF mẫu.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "../../apps/hub-api/node_modules/pdf-lib";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt — chạy qua deploy/smoke/smoke-journey.ps1`);
  return v;
};
export const E = {
  pw: need("SMOKE_PW"),
  cw: need("SMOKE_CW"),
  admin: need("SMOKE_ADMIN"),
  chat: need("SMOKE_CHAT"),
  out: need("SMOKE_OUT"),
  env: process.env.SMOKE_ENV ?? "test",
  cr169: process.env.SMOKE_CR169 === "1",
  /** Danh bạ công ty MẶC ĐỊNH lúc mới tạo (runner đọc trước khi bật): "on" | "off". */
  dir: { a: process.env.SMOKE_DIR_A ?? "?", b: process.env.SMOKE_DIR_B ?? "?" },
};
export const TAX = { a: "9900000011", b: "9900000022" } as const;
export const NAME = { a: "Công ty Smoke A", b: "Công ty Smoke B" } as const;
export type Co = "a" | "b";
export type Role = "gd" | "tp" | "nv";
export const acct = (c: Co, r: Role) => ({ tenant: `smoke-${c}`, user: `smoke-${c}-${r}` });

/** Đăng nhập một web (cw / admin / chat): form chung «Mã công ty» + «Email» + «Mật khẩu». */
export async function login(page: Page, base: string, c: Co, r: Role): Promise<void> {
  const a = acct(c, r);
  await page.goto(`${base}/login`);
  const pw = page.locator("input[type=password]").first();
  await pw.waitFor({ timeout: 45_000 });
  const tenant = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
  const change = page.getByRole("button", { name: "Đổi công ty" });
  if (!(await tenant.isVisible()) && (await change.isVisible())) await change.click();
  if (await tenant.count()) await tenant.fill(a.tenant);
  await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)/ }).fill(a.user);
  await pw.fill(E.pw);
  await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45_000 });
}

/** PDF thật (chữ không dấu: font chuẩn) — AI đọc được số HĐ, hai bên (kèm MST), giá trị. */
export async function pdfOf(lines: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  lines.forEach((l, i) => {
    page.drawText(l, { x: 40, y: 800 - i * 18, size: 11, font });
  });
  return Buffer.from(await pdf.save());
}

export type Row = {
  id: string;
  name: string;
  status: "Dat" | "Khong dat" | "Bo qua" | "Khong ap dung";
  note?: string;
};
export class Steps {
  rows: Row[] = [];
  page: Page | null = null;
  constructor(private readonly out: string) {
    fs.mkdirSync(out, { recursive: true });
  }
  /** Trang đang thao tác (để chụp ảnh khi lỗi). */
  use(p: Page): Page {
    this.page = p;
    return p;
  }
  private save(): void {
    fs.writeFileSync(path.join(this.out, "results.json"), JSON.stringify(this.rows, null, 1));
  }
  private async shot(id: string): Promise<void> {
    try {
      if (this.page && !this.page.isClosed())
        await this.page.screenshot({
          path: path.join(this.out, `${id}.png`),
          fullPage: false,
          timeout: 15_000,
        });
    } catch {
      /* ảnh chụp là phụ */
    }
  }
  ok(id: string): boolean {
    return this.rows.some(
      (r) => r.id === id && (r.status === "Dat" || r.status === "Khong ap dung"),
    );
  }
  /** `needs`: các bước trước phải Đạt, không thì Bỏ qua. Lỗi ⇒ ghi lý do ngắn + ảnh; KHÔNG ném (các bước độc lập vẫn chạy). */
  async run(
    id: string,
    name: string,
    fn: () => Promise<string | undefined>,
    needs: string[] = [],
  ): Promise<void> {
    const miss = needs.filter((n) => !this.ok(n));
    if (miss.length) {
      this.rows.push({ id, name, status: "Bo qua", note: `bước ${miss.join(",")} chưa đạt` });
      this.save();
      return;
    }
    try {
      const note = await fn();
      this.rows.push({ id, name, status: "Dat", ...(note ? { note } : {}) });
    } catch (e) {
      const msg = String((e as Error).message ?? e)
        .replace(new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g"), "")
        .split("\n")
        .slice(0, 3)
        .join(" ")
        .slice(0, 900);
      this.rows.push({ id, name, status: "Khong dat", note: msg });
    }
    await this.shot(id);
    this.save();
  }
  skip(id: string, name: string, note: string): void {
    this.rows.push({ id, name, status: "Khong ap dung", note });
    this.save();
  }
  get failed(): Row[] {
    return this.rows.filter((r) => r.status === "Khong dat" && r.id !== "AI");
  }
}
