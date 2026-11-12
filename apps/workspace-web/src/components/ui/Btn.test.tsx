// CR-134 · Btn: một cỡ chuẩn theo size, disabled + reason (Q7), loading.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Btn, btnClass } from "./Btn";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("Btn", () => {
  test("cỡ: md = .btn (40px), sm thêm .btn-sm (36px), icon không có btn-sm", () => {
    expect(btnClass("primary")).toBe("btn btn-primary");
    expect(btnClass("primary", "sm")).toBe("btn btn-primary btn-sm");
    expect(btnClass("danger")).toBe("btn btn-danger");
    expect(btnClass("icon", "sm")).toBe("btn-icon-ghost");
    expect(html(<Btn>Duyệt</Btn>)).toContain('type="button"');
  });

  test("disabled + reason ⇒ nút khoá, bọc span title, aria-describedby trỏ tới lý do", () => {
    const out = html(
      <Btn disabled reason="Chỉ quản lý được lưu">
        Lưu
      </Btn>,
    );
    expect(out).toContain("disabled");
    expect(out).toContain('title="Chỉ quản lý được lưu"');
    const id = /aria-describedby="([^"]+)"/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`id="${id}"`);
    expect(out).toContain("sr-only");
  });

  test("reason chỉ hiện khi disabled; còn được dùng thì không bọc", () => {
    const out = html(<Btn reason="x">Lưu</Btn>);
    expect(out).not.toContain("title=");
    expect(out).not.toContain("aria-describedby");
    expect(out.startsWith("<button")).toBe(true);
  });

  test("loading ⇒ khoá + aria-busy + vòng quay", () => {
    const out = html(<Btn loading>Lưu</Btn>);
    expect(out).toContain("disabled");
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("animate-spin");
  });
});
