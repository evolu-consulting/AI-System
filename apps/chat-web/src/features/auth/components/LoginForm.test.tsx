// CHAT-AC-01, CHAT-AC-02 · LoginForm (render tĩnh): nhãn e2e, mã công ty đã nhớ + "Đổi công ty", vùng alert lỗi chung.
import { beforeAll, describe, expect, test } from "bun:test";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { LoginForm } from "./LoginForm";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const render = (p: { defaultTenant?: string; pending?: boolean; error?: string | null }) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <LoginForm
        defaultTenant={p.defaultTenant ?? ""}
        pending={p.pending ?? false}
        error={p.error ?? null}
        onSubmit={() => {}}
      />
    </I18nextProvider>,
  );

describe("LoginForm", () => {
  test("CHAT-AC-01 · ba ô có <label> đúng nhãn e2e, mật khẩu là type=password", () => {
    const html = render({});
    for (const [id, label] of [
      ["login-tenant", "Mã công ty"],
      ["login-username", "Tên đăng nhập"],
      ["login-password", "Mật khẩu"],
    ]) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`>${label}</label>`);
    }
    expect(html).toMatch(
      /id="login-password"[^>]*type="password"|type="password"[^>]*id="login-password"/,
    );
    expect(html).toContain(">Đăng nhập</button>");
  });
  test("CHAT-AC-01 · chưa nhớ mã → ô sửa được, không có nút Đổi công ty", () => {
    const html = render({});
    expect(html).not.toContain("Đổi công ty");
    expect(html).not.toContain("readOnly");
    expect(html).not.toContain("readonly");
  });
  test("CHAT-AC-01 · đã nhớ mã → điền sẵn, khoá ô, có nút Đổi công ty", () => {
    const html = render({ defaultTenant: "acme" });
    expect(html).toContain('value="acme"');
    expect(html).toContain('readonly=""');
    expect(html).toContain(">Đổi công ty</button>");
  });
  test("CHAT-AC-02 · lỗi chung trong role=alert; đang gửi → nút disabled + Đang đăng nhập…", () => {
    const html = render({ error: "Sai mã công ty, tên đăng nhập hoặc mật khẩu", pending: true });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Sai mã công ty, tên đăng nhập hoặc mật khẩu");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Đang đăng nhập…<\/button>/);
  });
});
