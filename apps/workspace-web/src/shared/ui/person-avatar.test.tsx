// CR-185 · PersonAvatar: tooltip chỉ họ tên, aria-label, chữ cái đầu (render tĩnh ở đây vì web-kit không có react-dom).
import { describe, expect, test } from "bun:test";
import {
  AvatarListBody,
  PersonAvatar,
  PersonAvatarGroup,
  splitAvatars,
} from "@ai/web-kit/ui/kit/person-avatar";
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
  test("nhóm: tối đa 5 avatar + «+N»", () => {
    const people = ["A", "B", "C", "D", "E", "F", "G"].map((n) => ({ name: n }));
    const out = renderToStaticMarkup(<PersonAvatarGroup people={people} />);
    expect(out).toContain("+2");
    expect(out.match(/<span[^>]*>[A-G]<\/span>/g)?.length).toBe(5);
  });
  test("nhóm ≤ 5 người ⇒ không «+N»; nút mở có aria-label = các họ tên, vùng bấm 44px", () => {
    const out = renderToStaticMarkup(
      <PersonAvatarGroup people={[{ name: "An" }, { name: "Bình" }]} />,
    );
    expect(out).not.toContain("avatar-more");
    expect(out).toContain('aria-label="An, Bình"');
    expect(out).toContain("min-h-11");
  });
  test("splitAvatars: max 5, +n đúng", () => {
    expect(splitAvatars([1, 2, 3, 4, 5, 6, 7])).toEqual({ shown: [1, 2, 3, 4, 5], rest: 2 });
    expect(splitAvatars([1, 2])).toEqual({ shown: [1, 2], rest: 0 });
  });
  test("danh sách: họ tên + chức vụ, tới 8 không cuộn, trên 8 cuộn", () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `Người ${i}`, jobTitle: `CV ${i}` }));
    const small = renderToStaticMarkup(<AvatarListBody people={mk(8)} />);
    expect(small).toContain("CV 3");
    expect(small).not.toContain("overflow-y-auto");
    const big = renderToStaticMarkup(<AvatarListBody people={mk(9)} />);
    expect(big).toContain("overflow-y-auto");
    expect(big).toContain('data-scroll="true"');
  });
});
