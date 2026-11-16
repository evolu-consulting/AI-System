// CR-177: app nào dùng bộ component chung phải cho Tailwind quét web-kit + messages-web,
// nếu không lớp chỉ có trong kit (bg-primary, border-input…) không được sinh ⇒ nút chính mất màu (lỗi 2026-11-16).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

for (const app of ["workspace-web", "admin-web", "chat-web", "studio-web"]) {
  test(`${app}: globals.css có @source web-kit và messages-web`, () => {
    const css = readFileSync(
      new URL(`../../../../../apps/${app}/src/styles/globals.css`, import.meta.url),
      "utf8",
    );
    expect(css).toContain('@source "../../../../packages/web-kit/src"');
    expect(css).toContain('@source "../../../../packages/messages-web/src"');
  });
}
