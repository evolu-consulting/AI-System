// CR-175 · Dialog: Header/Footer cố định, chỉ DialogBody cuộn; 4 bản chép shadcn (workspace/admin/chat/studio) giữ cùng khung.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { DialogBody, DialogFooter, DialogHeader } from "./dialog";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("Dialog (CR-175)", () => {
  test("Header + Footer không co lại, Body là phần duy nhất overflow-y-auto", () => {
    const head = html(<DialogHeader>h</DialogHeader>);
    const foot = html(<DialogFooter>f</DialogFooter>);
    const body = html(<DialogBody>b</DialogBody>);
    expect(head).toContain('data-slot="dialog-header"');
    expect(head).toContain("shrink-0");
    expect(foot).toContain('data-slot="dialog-footer"');
    expect(foot).toContain("shrink-0");
    expect(head + foot).not.toContain("overflow-y-auto");
    expect(body).toContain('data-slot="dialog-body"');
    expect(body).toContain("overflow-y-auto");
    expect(body).toContain("min-h-0");
    expect(body).toContain("flex-1");
  });

  test("DialogBody nhận className thêm mà vẫn giữ lớp cuộn", () => {
    const body = html(<DialogBody className="gap-4">b</DialogBody>);
    expect(body).toContain("gap-4");
    expect(body).toContain("overflow-y-auto");
  });

  test("bộ chung (web-kit/ui/kit, admin-web dùng từ CR-177) cùng khung CR-175", () => {
    const src = readFileSync(
      new URL("../../../../../packages/web-kit/src/ui/kit/dialog.tsx", import.meta.url),
      "utf8",
    );
    for (const cls of ["max-h-[90vh]", "flex-col", "overflow-y-auto", "max-sm:max-h-[100dvh]"]) {
      expect(src).toContain(cls);
    }
    expect(src).toContain("export function DialogBody");
  });

  test("ba bản chép dialog còn lại cùng khung: cao tối đa 90vh, cột flex, có DialogBody", () => {
    for (const app of ["workspace-web", "chat-web", "studio-web"]) {
      const src = readFileSync(
        new URL(`../../../../${app}/src/components/ui/dialog.tsx`, import.meta.url),
        "utf8",
      );
      const content = src.slice(
        src.indexOf("function DialogContent"),
        src.indexOf("function DialogHeader"),
      );
      for (const cls of ["max-h-[90vh]", "flex-col", "overflow-y-auto", "max-sm:max-h-[100dvh]"]) {
        expect(content).toContain(cls);
      }
      expect(src).toContain("function DialogBody");
      expect(src).toMatch(/export \{[^}]*DialogBody/s);
    }
  });
});
