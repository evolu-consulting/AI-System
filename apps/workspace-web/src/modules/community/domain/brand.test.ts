// CR-110 · COM-FR-27/45 · ánh xạ brand → topbar; getBrand gọi đúng route; mock trả brand chủ quản cho mọi vai.
import { afterEach, describe, expect, it } from "bun:test";
import { createHttpApi } from "../adapters/http";
import { createMockApi } from "../adapters/mock";
import { toBrandView } from "./brand";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("toBrandView", () => {
  it("brand đầy đủ: tên, tên ứng dụng, logo, màu", () => {
    const v = toBrandView(
      { name: "NITI GROUP", appName: "Sổ NITI", logo: PNG, accent: "rose" },
      "x",
    );
    expect(v).toMatchObject({
      name: "NITI GROUP",
      appName: "Sổ NITI",
      logo: PNG,
      accent: "rose",
      initial: "NG",
    });
  });
  it("chưa có brand ⇒ tên dự phòng + chữ cái đầu + indigo, không logo (P5-AC07)", () => {
    const v = toBrandView(null, "Cơ sở Tân Phát");
    expect(v).toMatchObject({
      name: "Cơ sở Tân Phát",
      appName: null,
      logo: null,
      accent: "indigo",
    });
    expect(v.initial.length).toBeGreaterThan(0);
  });
  it("logo không phải data URL ảnh bị bỏ; appName rỗng ⇒ null; màu lạ ⇒ indigo", () => {
    const bad = { name: "A", appName: "  ", logo: "https://evil.example/x.png", accent: "pink" };
    // biome-ignore lint/suspicious/noExplicitAny: cố ý đưa giá trị ngoài contract để thử phòng thủ
    const v = toBrandView(bad as any, "x");
    expect(v).toMatchObject({ logo: null, appName: null, accent: "indigo" });
  });
});

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

describe("getBrand", () => {
  it("http: GET /pack/community/brand", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ name: "A", appName: null, logo: null, accent: "teal" }));
    }) as unknown as typeof fetch;
    expect((await createHttpApi().getBrand()).accent).toBe("teal");
    expect(calls[0]).toContain("/pack/community/brand");
  });
  it("mock: đối tác nhận đúng brand chủ quản (4 trường)", async () => {
    const m = createMockApi();
    m.setPersona("tp");
    expect(Object.keys(await m.api.getBrand()).sort()).toEqual([
      "accent",
      "appName",
      "logo",
      "name",
    ]);
  });
});

describe("CR-138 Q9 · ảnh bìa công ty", () => {
  it("safeCover: chỉ nhận data URL PNG/JPG/WebP, SVG/URL lạ/rỗng ⇒ null", async () => {
    const { safeCover } = await import("./brand");
    expect(safeCover("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(safeCover("data:image/jpeg;base64,AAAA")).not.toBeNull();
    expect(safeCover("data:image/webp;base64,AAAA")).not.toBeNull();
    expect(safeCover("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(safeCover("https://x.test/a.png")).toBeNull();
    expect(safeCover(null)).toBeNull();
  });
  it("http: GET /pack/community/brand/cover", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ cover: null }));
    }) as unknown as typeof fetch;
    expect(await createHttpApi().getBrandCover()).toEqual({ cover: null });
    expect(calls[0]).toContain("/pack/community/brand/cover");
  });
  it("mock: chưa có ảnh bìa ⇒ null", async () => {
    expect(await createMockApi().api.getBrandCover()).toEqual({ cover: null });
  });
});
