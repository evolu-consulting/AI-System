// PK-FR-10 · TF4 · LoginForm + AuthLayout (render tĩnh, i18n thật): nhãn e2e plan-frontend §7, ô "Mã công ty" chỉ khi chưa
// biết tenant (D-21), vùng alert lỗi chung, bản EN.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { AuthLayout } from "./AuthLayout";
import { LoginForm } from "./LoginForm";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const form = (p: { tenant?: string; busy?: boolean; error?: string | null }) =>
  renderToStaticMarkup(
    <LoginForm
      tenant={p.tenant ?? ""}
      busy={p.busy ?? false}
      error={p.error ?? null}
      onSubmit={() => {}}
    />,
  );

describe("LoginForm", () => {
  test("PK-FR-10 · chưa biết tenant ⇒ có ô Mã công ty; luôn có Email, Mật khẩu, Hiện mật khẩu, Đăng nhập", () => {
    const out = form({});
    expect(out).toContain("Mã công ty");
    expect(out).toContain('name="tenant_key"');
    expect(out).toContain("Email");
    expect(out).toContain('type="password"');
    expect(out).toContain('aria-label="Hiện mật khẩu"');
    expect(out).toContain(">Đăng nhập</button>");
    expect(out).not.toContain('role="alert"');
  });
  test("PK-FR-10 · biết tenant ⇒ không có ô Mã công ty, hiện tên công ty + nút Đổi công ty", () => {
    const out = form({ tenant: "acme" });
    expect(out).not.toContain('name="tenant_key"');
    expect(out).toContain("acme");
    expect(out).toContain("Đổi công ty");
  });
  test("PK-FR-10 · ô Email nhận tên đăng nhập (không ép type=email)", () => {
    expect(form({})).not.toContain('type="email"');
  });
  test("PK-FR-10 · lỗi ⇒ role=alert; đang gửi ⇒ nút khoá", () => {
    const out = form({ error: "Sai thông tin đăng nhập.", busy: true });
    expect(out).toContain('role="alert"');
    expect(out).toContain("Sai thông tin đăng nhập.");
    expect(out).toMatch(/<button type="submit"[^>]*disabled/);
  });
  test("PK-FR-10 · EN: Sign in / Company code", async () => {
    await i18n.changeLanguage("en");
    const out = form({});
    expect(out).toContain("Company code");
    expect(out).toContain(">Sign in</button>");
    await i18n.changeLanguage("vi");
  });
});

describe("AuthLayout", () => {
  test("PK-FR-10 · main chứa form, showcase aria-hidden (trang trí)", () => {
    const out = renderToStaticMarkup(
      <AuthLayout>
        <h1>x</h1>
      </AuthLayout>,
    );
    expect(out).toContain("<main");
    expect(out).toContain('aria-hidden="true" class="auth-show');
    expect(out).toContain("Sổ Hợp Tác");
  });
});
