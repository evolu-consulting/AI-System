// com-c10b · unit luật dock Trợ lý giá.
import { describe, expect, test } from "bun:test";
import type { ChatEvent } from "@ai/contracts/chat";
import { MessageContextSchema } from "@ai/contracts/chat";
import { applyEvent, buildRequest, dockContext, dockVisible, errorText, titleOf } from "./dock";

const ev = (e: unknown) => e as ChatEvent;

describe("dock · hiển thị", () => {
  test("đối tác không thấy nút; chủ quản thấy", () => {
    expect(dockVisible("partner")).toBe(false);
    expect(dockVisible("host_admin")).toBe(true);
    expect(dockVisible("host")).toBe(true);
  });
});

describe("dock · ngữ cảnh trang", () => {
  test("surface=community + route; hợp lệ theo schema Hub", () => {
    const c = dockContext({ route: "feed", search: "  USB   Token " });
    expect(c).toEqual({
      surface: "community",
      route: "/feed",
      selection: "Đang tìm trên bảng tin: USB Token",
    });
    expect(MessageContextSchema.safeParse(c).success).toBe(true);
  });
  test("hồ sơ đối tác có orgId; id lạ bị bỏ; không tìm ⇒ không selection", () => {
    expect(dockContext({ route: "profile", orgId: "org-1" })).toEqual({
      surface: "community",
      route: "/profile/org-1",
    });
    expect(dockContext({ route: "profile", orgId: "a/../b<x>" }).route).toBe("/profile");
  });
});

describe("dock · tin gửi + sự kiện", () => {
  test("tag @assistant, flow sau câu đầu, kèm ngữ cảnh", () => {
    const ctx = dockContext({ route: "feed" });
    expect(buildRequest(" Giá USB? ", null, ctx)).toEqual({
      content: "@assistant Giá USB?",
      context: ctx,
    });
    expect(buildRequest("x", "f1", ctx).flow_id).toBe("f1");
  });
  test("delta ghép, run.finished thay bản đủ, run.failed ghi lỗi", () => {
    let m = applyEvent(
      { role: "assistant", text: "", pending: true },
      ev({ event: "delta", data: { text: "Gi" } }),
    );
    m = applyEvent(m, ev({ event: "delta", data: { text: "á" } }));
    expect(m.text).toBe("Giá");
    m = applyEvent(
      m,
      ev({ event: "run.finished", data: { content: "Giá 95.000đ (Sổ giá, 01/10)" } }),
    );
    expect(m).toMatchObject({ text: "Giá 95.000đ (Sổ giá, 01/10)", pending: false });
    const f = applyEvent(m, ev({ event: "run.failed", data: { message: "lỗi" } }));
    expect(f.error).toBe("lỗi");
  });
  test("tiêu đề cắt 80 ký tự; lỗi 403 chat-gate ⇒ câu quyền", () => {
    expect(titleOf("a".repeat(200)).length).toBe(80);
    expect(titleOf("  ")).toBe("Trợ lý giá");
    expect(errorText("CHAT_APP_DISABLED")).toContain("chưa được dùng");
    expect(errorText("???")).toContain("chưa trả lời");
  });
});
