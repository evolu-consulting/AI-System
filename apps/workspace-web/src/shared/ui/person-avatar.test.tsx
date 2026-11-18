// CR-185 · PersonAvatar: tooltip chỉ họ tên, aria-label, chữ cái đầu (render tĩnh ở đây vì web-kit không có react-dom).
import { describe, expect, test } from "bun:test";
import { PersonAvatar, PersonAvatarGroup } from "@ai/web-kit/ui/kit/person-avatar";
import { renderToStaticMarkup } from "react-dom/server";

describe("PersonAvatar", () => {
  test("aria-label = họ tên, thiếu ảnh ⇒ chữ cái đầu, focus được", () => {
    const out = renderToStaticMarkup(<PersonAvatar name="Lê Minh Cường" id="u1" />);
    expect(out).toContain('aria-label="Lê Minh Cường"');
    expect(out).toContain("LC");
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('data-person="u1"');
  });
  test("có ảnh ⇒ vẽ ảnh, không chữ cái đầu", () => {
    const out = renderToStaticMarkup(
      <PersonAvatar name="Lê Minh Cường" src="data:image/png;base64,AA" />,
    );
    expect(out).toContain("<img");
    expect(out).not.toContain(">LC<");
  });
  test("viền và dấu nhỏ hiện ra, không có chữ trạng thái nào trong DOM của avatar", () => {
    const out = renderToStaticMarkup(
      <PersonAvatar name="An" ring="ring-act" badge={<i data-testid="mark" />} />,
    );
    expect(out).toContain("ring-act");
    expect(out).toContain('data-testid="mark"');
    expect(out).not.toMatch(/Phụ trách|Bên A|Đã ký/);
  });
  test("interactive=false ⇒ không focus", () => {
    expect(renderToStaticMarkup(<PersonAvatar name="An" interactive={false} />)).not.toContain(
      "tabindex",
    );
  });
  test("nhóm: tối đa 3 + «+N»", () => {
    const people = ["A", "B", "C", "D", "E"].map((n) => ({ name: n }));
    const out = renderToStaticMarkup(<PersonAvatarGroup people={people} />);
    expect(out).toContain("+2");
  });
});
