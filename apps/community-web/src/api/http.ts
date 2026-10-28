// CR-102 · C5 · adapter HTTP — STUB: C3 (backend) nối thật. Mỗi hàm ghi sẵn route mong đợi (xem client.ts).
import type { CommunityApi } from "./client";

const pending = (what: string): never => {
  throw new Error(
    `Community API chưa có backend (C3): ${what}. Chạy với PUBLIC_COMMUNITY_API=mock.`,
  );
};

export function createHttpApi(): CommunityApi {
  return new Proxy({} as CommunityApi, {
    get:
      (_t, prop) =>
      (..._a: unknown[]): Promise<never> =>
        Promise.reject(new Error(`Community API chưa có backend (C3): ${String(prop)}`)),
  });
}

export { pending };
