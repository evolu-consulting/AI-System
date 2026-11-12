// CR-131 · EmptyState: kind → hình + data-kind; action/hint hiện; NotFoundPage có nút về trang chính.
import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { EmptyState, NotFoundPage } from "./EmptyState";
import { ILLUSTRATIONS } from "./illustrations";

const KINDS = ["empty", "search", "notFound", "off", "error"] as const;
type El = ReactElement<{ children: unknown; [k: string]: unknown }>;
const text = (n: unknown): string =>
  typeof n === "string"
    ? n
    : Array.isArray(n)
      ? n.map(text).join("|")
      : n && typeof n === "object" && "props" in n
        ? text((n as El).props.children)
        : "";

describe("EmptyState", () => {
  test("mỗi kind có một hình riêng và render data-kind", () => {
    expect(new Set(KINDS.map((k) => ILLUSTRATIONS[k])).size).toBe(5);
    for (const kind of KINDS) {
      const el = EmptyState({ kind, title: "T", testId: `x-${kind}` }) as El;
      expect(el.props["data-kind"]).toBe(kind);
      expect(el.props["data-testid"]).toBe(`x-${kind}`);
    }
  });
  test("title, hint, action đều hiện; error có role=alert", () => {
    const el = EmptyState({
      kind: "error",
      title: "Mất kết nối",
      hint: "Thử lại",
      action: "BTN",
    }) as El;
    expect(text(el)).toContain("Mất kết nối");
    expect(text(el)).toContain("Thử lại");
    expect(text(el)).toContain("BTN");
    expect(el.props.role).toBe("alert");
  });
  test("không hint/action ⇒ không dựng khối thừa", () => {
    const el = EmptyState({ kind: "empty", title: "T" }) as El;
    expect((el.props.children as unknown[]).filter(Boolean)).toHaveLength(2);
  });
  test("NotFoundPage = kind notFound + nút về trang chính", () => {
    const el = NotFoundPage({ title: "T", homeTo: "/contracts", homeLabel: "Về Tổng quan" }) as El;
    expect(el.props.kind).toBe("notFound");
    expect(text(el.props.action)).toBe("Về Tổng quan");
  });
});
