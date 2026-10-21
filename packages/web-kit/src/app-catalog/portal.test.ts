// portal-home · luật thuần: nơi hạ cánh sau đăng nhập, ánh xạ con số thẻ.
import { describe, expect, it } from "bun:test";
import type { MeApp } from "@ai/contracts";
import { entryNext, entryUrl } from "./apps";
import {
  adminNumbers,
  contractsNumbers,
  landingFor,
  recentConversations,
  tileNumbers,
} from "./portal";

const app = (key: string, url = `https://${key}.x`): MeApp => ({
  key,
  name: { vi: key },
  icon: "app",
  url,
  sso: true,
});
const APPS = [app("chat"), app("contracts"), app("studio"), app("admin")];

describe("landingFor", () => {
  it("không đặt mặc định ⇒ trang chủ; ?home=1 thắng mọi mặc định", () => {
    expect(landingFor(null, APPS, false)).toEqual({ kind: "portal" });
    expect(landingFor("contracts", APPS, true)).toEqual({ kind: "portal" });
  });
  it("mặc định chat ⇒ chat; app khác ⇒ chuyển phiên; app không có trong danh sách ⇒ trang chủ", () => {
    expect(landingFor("chat", APPS, false)).toEqual({ kind: "chat" });
    expect(landingFor("contracts", APPS, false)).toEqual({ kind: "app", app: app("contracts") });
    expect(landingFor("gone", APPS, false)).toEqual({ kind: "portal" });
    expect(landingFor("admin", [app("admin", "")], false)).toEqual({ kind: "portal" });
  });
});

describe("số trên thẻ", () => {
  it("Sổ Hợp Tác: Cần xử lý + HĐ hết hạn ≤ 30 ngày", () => {
    const todo = {
      counts: { total: 7 },
      items: [
        { kind: "contract_expiring", days: 12 },
        { kind: "contract_expiring", days: 45 },
        { kind: "overdue", days: -3 },
      ],
    };
    expect(contractsNumbers(todo)).toEqual({ todo: 7, expiring30: 1 });
    expect(tileNumbers("contracts", { contracts: contractsNumbers(todo) })).toEqual([
      { key: "todo", value: 7 },
      { key: "expiring30", value: 1 },
    ]);
  });
  it("Quản trị chỉ khi server trả khối admin; app khác không có số", () => {
    expect(adminNumbers({ admin: null })).toBeNull();
    const a = adminNumbers({ admin: { new_users_7d: 4, pending_feedback: 2 } });
    expect(tileNumbers("admin", { admin: a })).toEqual([
      { key: "newUsers7d", value: 4 },
      { key: "pendingFeedback", value: 2 },
    ]);
    expect(tileNumbers("studio", { admin: a })).toEqual([]);
    expect(tileNumbers("contracts", {})).toEqual([]);
  });
  it("3 hội thoại gần nhất", () => {
    const c = ["2026-01-01", "2026-03-01", "2026-02-01", "2026-04-01"].map((d) => ({
      updated_at: d,
    }));
    expect(recentConversations(c).map((x) => x.updated_at)).toEqual([
      "2026-04-01",
      "2026-03-01",
      "2026-02-01",
    ]);
  });
});

describe("chat dưới /chat", () => {
  it("URL và next của Chat AI trỏ /chat, app khác ở gốc", () => {
    expect(entryUrl(app("chat"))).toBe("https://chat.x/chat");
    expect(entryUrl(app("chat", ""))).toBe("/chat");
    expect(entryNext(app("chat"))).toBe("/chat");
    expect(entryUrl(app("admin"))).toBe("https://admin.x");
    expect(entryNext(app("admin"))).toBe("/");
  });
});
