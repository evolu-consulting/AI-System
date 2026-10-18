/// <reference lib="dom" />
// UAT P-d1 · helper dùng chung: step() không dừng khi FAIL (ghi result), shot() chụp vào thư mục evidence.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

export const EV = join(process.cwd(), "docs/specs/P-d-durable/evidence/2026-10-18");
mkdirSync(EV, { recursive: true });
export type R = { id: string; title: string; ok: boolean; note: string; shots: string[] };

export const shot = async (p: Page, name: string, full = false): Promise<string> => {
  const file = `${name}.png`;
  await p.screenshot({ path: join(EV, file), fullPage: full });
  return file;
};

/** Chạy một bước; FAIL ⇒ chụp trang + ghi lỗi, KHÔNG ném (các bước sau vẫn chạy). */
export async function step(
  id: string,
  title: string,
  page: Page | undefined,
  fn: () => Promise<string | void>,
): Promise<boolean> {
  let r: R;
  try {
    const note = (await fn()) ?? "";
    r = { id, title, ok: true, note, shots: [] };
  } catch (e) {
    const msg = String((e as Error).message ?? e).split("\n").slice(0, 6).join(" | ");
    const shots: string[] = [];
    if (page) {
      try {
        shots.push(await shot(page, `FAIL-${id}`));
      } catch {
        // trang đóng
      }
    }
    r = { id, title, ok: false, note: msg, shots };
  }
  appendFileSync(join(EV, "result.jsonl"), `${JSON.stringify(r)}\n`);
  console.log(`${r.ok ? "PASS" : "FAIL"} ${id} ${title} ${r.note}`);
  return r.ok;
}

export const note = (id: string, title: string, text: string): void => {
  appendFileSync(
    join(EV, "result.jsonl"),
    `${JSON.stringify({ id, title, ok: false, note: `NOTE/BLOCKED: ${text}`, shots: [] })}\n`,
  );
};
