// Chọn adapter theo cờ `PUBLIC_COMMUNITY_API` = "http" | "mock". Vắng: bản build (production) ⇒ http (C3, server thật);
// dev ⇒ mock (chạy không cần backend). Dev với backend: `PUBLIC_COMMUNITY_API=http`.
import type { CommunityApi } from "./client";
import { createHttpApi } from "./http";
import { createMockApi, PERSONAS } from "./mock";

export type ApiMode = "mock" | "http";
const flag = import.meta.env.PUBLIC_COMMUNITY_API;
export const apiMode: ApiMode =
  flag === "http" || flag === "mock" ? flag : import.meta.env.DEV ? "mock" : "http";

export type Api = {
  api: CommunityApi;
  personas?: typeof PERSONAS;
  setPersona?: (id: string) => void;
};

export function createApi(mode: ApiMode = apiMode): Api {
  if (mode === "http") return { api: createHttpApi() };
  const mock = createMockApi();
  return { api: mock.api, personas: PERSONAS, setPersona: mock.setPersona };
}
