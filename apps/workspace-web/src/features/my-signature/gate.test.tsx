// CR-181 · s4 · màn chặn lần đầu đăng nhập + trang «Chữ ký của tôi»: luật chặn, «Làm sau», khoá đổi, menu.
import { describe, expect, test } from "bun:test";
import type { MySignatureView } from "@ai/contracts/signature";
import { SIGNATURE_SETTINGS_DEFAULT } from "@ai/contracts/signature";
import { renderToStaticMarkup } from "react-dom/server";
import { GateScreen } from "./components/FirstLoginGate";
import { MySignatureCards } from "./components/MySignatureCards";
import { firstStep, shouldBlock, showMenu } from "./lib/gate";

const view = (
  o: Partial<MySignatureView> = {},
  s: Partial<MySignatureView["settings"]> = {},
): MySignatureView => ({
  settings: { ...SIGNATURE_SETTINGS_DEFAULT, on_doc_enabled: true, ...s },
  main: null,
  initials: null,
  history: [],
  needs_create: true,
  change: "none",
  can_change: true,
  digital: { enabled: false, assigned: false },
  ...o,
});
const noop = () => {};
const gate = (v: MySignatureView) =>
  renderToStaticMarkup(
    <GateScreen
      view={v}
      person={{ name: "Hùng", company: "Acme" }}
      save={async () => {}}
      onDone={noop}
      onLater={noop}
      onFail={noop}
    />,
  );
const png = "data:image/png;base64,AAAA";
const item = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "main",
  method: "draw",
  image: png,
  created_at: "2026-11-02T08:30:00.000Z",
} as const;

describe("màn chặn", () => {
  test("needs_create ⇒ chặn và hiện màn", () => {
    expect(shouldBlock(view(), false)).toBe(true);
    expect(gate(view())).toContain("sig-gate");
  });
  test("công ty tắt / chưa tải / API lỗi ⇒ không chặn", () => {
    expect(shouldBlock(view({ needs_create: false }), false)).toBe(false);
    expect(shouldBlock(undefined, false)).toBe(false);
  });
  test("bắt buộc ⇒ không có «Làm sau», không bắt buộc ⇒ có, và nhớ thì không chặn", () => {
    expect(gate(view({}, { required: true }))).not.toContain("contracts.mySig.later");
    expect(gate(view({}, { required: false }))).toContain("contracts.mySig.later");
    expect(shouldBlock(view({}, { required: false }), true)).toBe(false);
    expect(shouldBlock(view({}, { required: true }), true)).toBe(true);
  });
  test("initials = own: đã có chữ ký chính ⇒ vào thẳng bước chữ ký tắt", () => {
    const v = view({ main: { ...item } }, { initials: "own" });
    expect(firstStep(v)).toBe("initials");
    expect(gate(v)).toContain("contracts.mySig.titleInitials");
    expect(firstStep(view())).toBe("main");
  });
});

describe("Chữ ký của tôi", () => {
  const cards = (v: MySignatureView) =>
    renderToStaticMarkup(<MySignatureCards view={v} onCreate={noop} onRequest={noop} />);
  test("can_change = false ⇒ nút khoá + lý do + «Xin đổi chữ ký»", () => {
    const h = cards(view({ main: { ...item }, needs_create: false, can_change: false }));
    expect(h).toContain("disabled");
    expect(h).toContain("contracts.mySig.page.locked");
    expect(h).toContain("contracts.mySig.page.request");
  });
  test("đã xin ⇒ báo chờ, không còn nút xin, can_change ⇒ không khoá", () => {
    const h = cards(
      view({ main: { ...item }, needs_create: false, can_change: false, change: "requested" }),
    );
    expect(h).toContain("contracts.mySig.page.requested");
    expect(h).not.toContain("contracts.mySig.page.request<");
    const ok = cards(view({ main: { ...item }, needs_create: false }));
    expect(ok).not.toContain("sig-locked");
  });
  test("thẻ chữ ký số: «Chưa được gán»", () => {
    expect(cards(view())).toContain("contracts.mySig.page.notAssigned");
  });
  test("menu chỉ hiện khi công ty bật", () => {
    expect(showMenu(view())).toBe(true);
    expect(showMenu(view({}, { on_doc_enabled: false }))).toBe(false);
    expect(showMenu(undefined)).toBe(false);
  });
});
