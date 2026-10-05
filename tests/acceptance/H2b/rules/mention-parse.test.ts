// HUB-FR-91 · HUB-BR-18 · HUB-H2b-AC-01 · H2b-R01, R04 · routeMessage, parseMention (test-plan H2b §4 R01–R08,
// cases §1.1; chữ ký plan-rules).
import { describe, expect, it } from "bun:test";
import { classifyMessage } from "../../../../apps/hub-api/src/modules/commands/command-parse.rules";
import {
  parseMention,
  type Routed,
  routeMessage,
} from "../../../../apps/hub-api/src/modules/mention/mention-parse.rules";

const text = (content: string): Routed => ({ kind: "text", content });
const mention = (tags: string[], content: string): Routed => ({ kind: "mention", tags, content });
const EMPTY_TAG: Routed = { kind: "mention_error", reason: "empty_tag" };

function expectRoutes(cases: [string, Routed][]): void {
  for (const [input, want] of cases) expect([input, routeMessage(input)]).toEqual([input, want]);
}

describe("HUB-FR-91 · phân loại tin `/`, `@`, chữ [R01–R03]", () => {
  it("HUB-FR-91 · R01 · chữ thường giữ nguyên văn (không trim), `@` giữa tin là chữ [H2b-R01]", () => {
    expectRoutes([
      ["xin chào", text("xin chào")],
      ["  xin", text("  xin")],
      ["x @a", text("x @a")],
    ]);
  });

  it("HUB-FR-91 · R02 · bắt đầu `/` → đúng kết quả classifyMessage [H2b-R01]", () => {
    for (const s of ["/dich en", "//abc", "  /dich x", "/"]) {
      expect([s, routeMessage(s)]).toEqual([s, classifyMessage(s)]);
    }
  });

  it("HUB-FR-91 · R03 · `@@` → chữ bỏ một `@` (sau khi bỏ khoảng trắng đầu) [H2b-R01]", () => {
    expectRoutes([
      ["@@abc", text("@abc")],
      ["  @@a b", text("@a b")],
      ["@@", text("@")],
      ["@@@x", text("@@x")],
    ]);
  });
});

describe("HUB-FR-91 · HUB-H2b-AC-01 · tag `@` đầu tin [R04–R08]", () => {
  it("HUB-FR-91 · R04 · tags lower, gộp trùng giữ thứ tự xuất hiện đầu [H2b-R01]", () => {
    expectRoutes([
      ["@a x", mention(["a"], "x")],
      ["@A x", mention(["a"], "x")],
      ["@a @b x", mention(["a", "b"], "x")],
      ["@a @a x", mention(["a"], "x")],
      ["@A @a x", mention(["a"], "x")],
      ["@b @a @B x", mention(["b", "a"], "x")],
    ]);
    expect(parseMention("@a @b x")).toEqual(mention(["a", "b"], "x"));
  });

  it("HUB-FR-91 · R05 · nội dung sau tag cuối trim hai đầu, giữ khoảng trắng giữa [H2b-R04]", () => {
    expectRoutes([
      ["@a", mention(["a"], "")],
      ["@a   ", mention(["a"], "")],
      ["@a \t x  ", mention(["a"], "x")],
      ["@a x  y ", mention(["a"], "x  y")],
    ]);
    expect(parseMention("@a")).toEqual(mention(["a"], ""));
  });

  it("HUB-FR-91 · HUB-BR-18 · R06 · `@` trơn đầu tin → empty_tag; `@` trơn sau tag → nội dung [H2b-R01]", () => {
    expectRoutes([
      ["@", EMPTY_TAG],
      ["@ x", EMPTY_TAG],
      ["  @", EMPTY_TAG],
      ["@\tx", EMPTY_TAG],
      ["@a @", mention(["a"], "@")],
      ["@a @ x", mention(["a"], "@ x")],
    ]);
    expect(parseMention("@")).toEqual(EMPTY_TAG);
  });

  it("HUB-FR-91 · R07 · `@a /dich en` → nội dung là chữ `/dich en`; dừng ở token không `@` [H2b-R01]", () => {
    expectRoutes([
      ["@a /dich en", mention(["a"], "/dich en")],
      ["@a x @b", mention(["a"], "x @b")],
    ]);
  });

  it("HUB-FR-91 · R08 · chỉ khoảng trắng ASCII tách token; dấu/emoji giữ nguyên [H2b-R01]", () => {
    expectRoutes([
      ["@a x", mention(["a x"], "")],
      ["@Trợ x", mention(["trợ"], "x")],
      ["@a Xin chào 😀 nhé", mention(["a"], "Xin chào 😀 nhé")],
    ]);
  });
});
