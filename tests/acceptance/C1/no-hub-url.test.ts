// CHAT-AC-34 · chat-web không nhúng URL Hub/Auth; địa chỉ đến từ proxy (spec §9 M10: quét chỉ do test này) [U-9].
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHAT_WEB, CHAT_WEB_ENABLED } from "./_gate";

const FORBIDDEN = ["localhost", "127.0.0.1", ":4020", ":3001"];

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => name.endsWith(x))) out.push(p);
  }
  return out;
}

describe.skipIf(!CHAT_WEB_ENABLED)("no-hub-url", () => {
  const src = join(CHAT_WEB, "src");

  it("CHAT-AC-34 · apps/chat-web/src tồn tại [U-9]", () => {
    expect(existsSync(src)).toBe(true);
  });

  it("CHAT-AC-34 · src/**/*.{ts,tsx} không chứa localhost, 127.0.0.1, :4020, :3001 [U-9]", () => {
    expect(existsSync(src)).toBe(true);
    const files = walk(src, [".ts", ".tsx"]);
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const bad of FORBIDDEN) if (text.includes(bad)) hits.push(`${f} chứa ${bad}`);
    }
    expect(hits).toEqual([]);
  });

  it("CHAT-AC-34 · bundle dist (nếu đã build) không chứa localhost:4020 [U-9]", () => {
    expect(existsSync(CHAT_WEB)).toBe(true);
    const dist = join(CHAT_WEB, "dist");
    if (!existsSync(dist)) return;
    const hits = walk(dist, [".js", ".html", ".css"]).filter((f) =>
      readFileSync(f, "utf8").includes("localhost:4020"),
    );
    expect(hits).toEqual([]);
  });
});
