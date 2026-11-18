// CR-182 · soát #9 — khôi phục `provider` của def khi công ty tắt «ký trên tài liệu» giữa lượt (luật thuần).
import { describe, expect, it } from "bun:test";
import { restoreProvider } from "./roles.repo";

const c = (v: string) => ({ from: "const", value: v });
const sign = (provider: string | null, role: string | null = "vai-ky") => ({
  name: "Ký",
  executor: {
    kind: "tool",
    tool_key: "contracts-esign-send",
    args: {
      ...(provider ? { provider: c(provider) } : {}),
      ...(role ? { signer_role: c(role) } : {}),
    },
  },
});
const prov = (s: unknown) =>
  (s as { executor: { args: { provider?: { value: string } } } }).executor.args.provider?.value;

describe("restoreProvider", () => {
  it("tắt on_doc + bản chụp ondoc + def có provider ⇒ trả provider của def", () => {
    expect(prov(restoreProvider(sign("ondoc"), { ondoc: false, defProvider: "docusign" }))).toBe(
      "docusign",
    );
  });
  it("còn bật on_doc, def không có provider / cũng là ondoc, bản chụp không phải ondoc, bước không có vai ⇒ giữ nguyên", () => {
    const s = sign("ondoc");
    expect(restoreProvider(s, { ondoc: true, defProvider: "docusign" })).toBe(s);
    expect(restoreProvider(s, { ondoc: false, defProvider: null })).toBe(s);
    expect(restoreProvider(s, { ondoc: false, defProvider: "ondoc" })).toBe(s);
    const x = sign("upload");
    expect(restoreProvider(x, { ondoc: false, defProvider: "docusign" })).toBe(x);
    const nr = sign("ondoc", null);
    expect(restoreProvider(nr, { ondoc: false, defProvider: "docusign" })).toBe(nr);
  });
});
