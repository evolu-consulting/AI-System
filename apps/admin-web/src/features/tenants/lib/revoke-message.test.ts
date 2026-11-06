// CR-110 low · hộp xác nhận thu hồi liệt kê tên thân thiện của mọi feature bị thu hồi (kể cả tính năng thêm khi app về Tắt).
import { describe, expect, test } from "bun:test";
import { appOfKey } from "@/features/features/lib/feature-fixtures";
import { buildCards, diffEntitlements, setLevel, type TenantFeature } from "./feature-assign";
import { revokeMessage } from "./revoke-message";

const feat = (key: string, entitled: boolean): TenantFeature => ({
  id: key,
  key,
  name: { vi: `Tên ${key}` },
  app: appOfKey(key),
  entitled,
});
const tr = (key: string, p?: Record<string, string | number>) =>
  key.startsWith("featmeta.f.") ? `N(${key.split(".")[2]})` : `${key}|${p?.count}|${p?.list}`;

describe("revokeMessage", () => {
  test("liệt kê tên của mọi feature thu hồi, gồm tính năng thêm khi đặt app về Tắt", () => {
    const all = [
      feat("contracts-read", true),
      feat("contracts-write", true),
      feat("han-muc-duyet", true),
      feat("chat-app", true),
    ];
    const card = buildCards(all).find((c) => c.app === "contracts");
    if (!card) throw new Error("card");
    const draft = setLevel(new Set(all.map((f) => f.key)), card, "off");
    const { revoke } = diffEntitlements(all, draft);
    expect(revokeMessage(tr, "vi", revoke)).toBe(
      "tenants.features.confirmBody|3|N(contracts-read), N(contracts-write), N(han-muc-duyet)",
    );
  });

  test("key lạ dùng tên server theo ngôn ngữ", () => {
    const msg = revokeMessage(tr, "vi", [feat("ke-toan", true)]);
    expect(msg).toBe("tenants.features.confirmBody|1|Tên ke-toan");
  });
});
