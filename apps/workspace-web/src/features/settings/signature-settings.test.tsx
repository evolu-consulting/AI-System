// CR-181 · s5 · Cài đặt › Chữ ký: người thường thấy form khoá, bỏ hết cách tạo bị chặn, thân PUT đúng schema, «Chữ ký số» khoá, yêu cầu đổi, nhóm «Chung».
import { describe, expect, test } from "bun:test";
import {
  SIGNATURE_SETTINGS_DEFAULT,
  SignatureSettingsSchema,
  type SignatureSettingsView,
} from "@ai/contracts/signature";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { signatureKeys } from "./api-signature";
import { buildNavGroups } from "./components/SettingsNav";
import { DigitalCard } from "./components/SignatureAside";
import { SignaturePane } from "./components/SignaturePane";
import { navFromKey, pickNav } from "./lib/section-key";
import { putBody, toggleMethod } from "./lib/signature-form";

const view = (can_edit: boolean): SignatureSettingsView => ({
  settings: SIGNATURE_SETTINGS_DEFAULT,
  stored: true,
  updated_by: null,
  updated_at: null,
  can_edit,
});
function html(can_edit: boolean, requests?: unknown) {
  const qc = new QueryClient();
  qc.setQueryData(signatureKeys.settings, view(can_edit));
  if (requests) qc.setQueryData(signatureKeys.requests, requests);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <SignaturePane />
    </QueryClientProvider>,
  );
}
const K = "contracts.settings.signature.";

describe("người thường", () => {
  test("form khoá + câu «Chỉ quản trị công ty sửa»", () => {
    const h = html(false);
    expect(h).toContain(`${K}adminOnly`);
    expect(h).toMatch(/<fieldset[^>]*disabled/);
    expect(h).not.toContain(`${K}requests.title`);
  });
  test("quản trị: form mở, không có câu khoá", () => {
    const h = html(true);
    expect(h).not.toContain('data-testid="sig-readonly"');
    expect(h).not.toMatch(/<fieldset[^>]*disabled[^>]*data-testid="sig-format"/);
  });
});

describe("cách tạo", () => {
  test("bỏ hết cách tạo ⇒ bị chặn, giữ nguyên", () => {
    const one = { ...SIGNATURE_SETTINGS_DEFAULT, methods: ["draw" as const] };
    const r = toggleMethod(one, "draw", false);
    expect(r.blocked).toBe(true);
    expect(r.next.methods).toEqual(["draw"]);
    expect(toggleMethod(one, "type", true).next.methods).toEqual(["draw", "type"]);
  });
});

describe("thân PUT", () => {
  test("đúng schema strict, đủ khoá", () => {
    const s = { ...SIGNATURE_SETTINGS_DEFAULT, ink: "black" as const };
    const b = putBody({ ...s, extra: 1 } as never);
    expect(SignatureSettingsSchema.safeParse(b).success).toBe(true);
    expect(b.ink).toBe("black");
    expect(b.caption).toEqual(SIGNATURE_SETTINGS_DEFAULT.caption); // giữ nguyên, không còn ô sửa
    expect("extra" in b).toBe(false);
  });
});

describe("chữ ký số", () => {
  test("huy hiệu «Chưa bật» + nút khoá", () => {
    const h = renderToStaticMarkup(<DigitalCard />);
    expect(h).toContain(`${K}digital.off`);
    expect(h).toContain(`${K}digital.enable`);
    expect(h).toContain('aria-disabled="true"');
  });
});

describe("yêu cầu đổi chữ ký", () => {
  const items = {
    items: [
      {
        user_id: "u1",
        name: "An",
        requested_at: "2026-11-17T01:00:00Z",
        granted_at: null,
        granted_by: null,
      },
    ],
  };
  test("quản trị thấy tên + nút «Cho phép»", () => {
    const h = html(true, items);
    expect(h).toContain("An");
    expect(h).toContain(`${K}requests.allow`);
  });
  test("người thường không thấy khối", () => {
    expect(html(false, items)).not.toContain(`${K}requests.allow`);
  });
});

describe("nhóm Chung", () => {
  const s = (k: string) => k;
  test("có mục «Chữ ký», mọi thành viên thấy (kể cả không phải chủ sở hữu)", () => {
    for (const owner of [true, false]) {
      const g = buildNavGroups({ hasContracts: true, hasFeed: true, owner, s, dot: () => null });
      const c = g.find((x) => x.id === "common");
      expect(c?.label).toBe("group.common");
      expect(c?.items.map((i) => i.id)).toEqual(["signature"]);
    }
  });
  test("khoá signature mở thẳng mục, không phụ thuộc quyền", () => {
    expect(navFromKey("signature")).toBe("signature");
    expect(pickNav("signature", true, false, false)).toBe("signature");
  });
});

describe("bật ký trên tài liệu", () => {
  test("onDocBody: chỉ đổi cờ trên bản đã lưu, đúng schema", async () => {
    const { onDocBody } = await import("./lib/signature-form");
    const b = onDocBody({ ...SIGNATURE_SETTINGS_DEFAULT, on_doc_enabled: false, ink: "black" });
    expect(b.on_doc_enabled).toBe(true);
    expect(b.ink).toBe("black");
    expect(SignatureSettingsSchema.safeParse(b).success).toBe(true);
  });
});
