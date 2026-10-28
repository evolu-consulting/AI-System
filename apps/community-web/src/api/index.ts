// Chọn adapter theo cờ môi trường `PUBLIC_COMMUNITY_API` = "mock" (mặc định cho tới khi C3 xong) | "http".
import type { CommunityApi } from "./client";
import { createHttpApi } from "./http";
import { createMockApi, PERSONAS } from "./mock";

export type ApiMode = "mock" | "http";
export const apiMode: ApiMode = import.meta.env.PUBLIC_COMMUNITY_API === "http" ? "http" : "mock";

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
