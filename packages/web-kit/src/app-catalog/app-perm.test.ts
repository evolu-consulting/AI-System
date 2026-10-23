// app-perm · switcher một app ⇒ không có "Trang chủ AI System"; không dùng được Chat AI ⇒ hạ cánh app mặc định / app duy nhất.
import { describe, expect, it } from "bun:test";
import { type MeApp, showsHome } from "./apps";
import { landingFor, noChatLanding } from "./portal";

const app = (key: string, url = `https://${key}.x`): MeApp => ({
  key,
  name: { vi: key },
  icon: "app",
  url,
  sso: true,
});
const CONTRACTS = app("contracts");

describe("showsHome", () => {
  it("chỉ một app (kể cả chỉ Chat AI) ⇒ không có trang chủ", () => {
    expect(showsHome([CONTRACTS])).toBe(false);
    expect(showsHome([app("chat")])).toBe(false);
  });
  it("không có Chat AI ⇒ không có trang chủ dù nhiều app", () => {
    expect(showsHome([CONTRACTS, app("admin")])).toBe(false);
  });
  it("Chat AI + app khác ⇒ có trang chủ (như cũ)", () => {
    expect(showsHome([app("chat"), CONTRACTS])).toBe(true);
  });
});

describe("hạ cánh khi không dùng được Chat AI", () => {
  it("chưa đặt mặc định ⇒ app đầu tiên mở được (Sổ Hợp Tác); `?home=1` cũng không giữ ở trang chủ", () => {
    expect(noChatLanding(null, [CONTRACTS])).toEqual({ kind: "app", app: CONTRACTS });
    expect(landingFor(null, [CONTRACTS], true, false)).toEqual({ kind: "app", app: CONTRACTS });
  });
  it("mặc định mở được ⇒ vào đó; mặc định là chat/không mở được ⇒ app đầu tiên", () => {
    const admin = app("admin");
    expect(noChatLanding("admin", [CONTRACTS, admin])).toEqual({ kind: "app", app: admin });
    expect(noChatLanding("chat", [app("chat"), CONTRACTS])).toEqual({
      kind: "app",
      app: CONTRACTS,
    });
  });
  it("không còn app nào có URL ⇒ trang chủ", () => {
    expect(noChatLanding("contracts", [app("contracts", "")])).toEqual({ kind: "portal" });
  });
  it("dùng được Chat AI ⇒ luật cũ giữ nguyên", () => {
    expect(landingFor(null, [CONTRACTS], false, true)).toEqual({ kind: "portal" });
    expect(landingFor("chat", [], false)).toEqual({ kind: "chat" });
  });
});
