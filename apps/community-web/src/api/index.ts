// Chọn adapter theo cờ `PUBLIC_COMMUNITY_API` = "http" | "mock". Vắng: bản build (production) ⇒ http (C3, server thật);
// dev ⇒ mock (chạy không cần backend). Dev với backend: `PUBLIC_COMMUNITY_API=http`.
// Review Thấp-12: hằng build `__COMMUNITY_MOCK__` (rsbuild.config.ts) + `import()` ⇒ bản production không chứa mock + dữ liệu mẫu
// (`seed.ts`); check:bundle kiểm dấu dữ liệu mẫu.
import type { CommunityApi } from "./client";
import { createHttpApi } from "./http";
import type { Persona } from "./seed";

declare const __COMMUNITY_MOCK__: boolean;

export type ApiMode = "mock" | "http";
export const apiMode: ApiMode =
  typeof __COMMUNITY_MOCK__ !== "undefined" && __COMMUNITY_MOCK__ ? "mock" : "http";

export type Api = {
  api: CommunityApi;
  personas?: readonly Persona[];
  setPersona?: (id: string) => void;
};

export async function createApi(): Promise<Api> {
  if (typeof __COMMUNITY_MOCK__ === "undefined" || !__COMMUNITY_MOCK__)
    return { api: createHttpApi() };
  const { createMockApi, PERSONAS } = await import("./mock");
  const mock = createMockApi();
  return { api: mock.api, personas: PERSONAS, setPersona: mock.setPersona };
}
