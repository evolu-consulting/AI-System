// dlc-dify · phần dùng chung của các route workspace DLC: lỗi HTTP có mã, đọc body JSON theo zod, mẫu khoá project / nhánh.
import type { z } from "zod";

export const KEY_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
export const BRANCH_RE = /^(main|task-[a-z0-9-]{1,48}|[a-z0-9][a-z0-9-]{1,48})$/;
export const now = () => new Date().toISOString();

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export const body = async <T extends z.ZodType>(
  c: { req: { json(): Promise<unknown> } },
  s: T,
): Promise<z.infer<T>> => {
  const r = s.safeParse(await c.req.json().catch(() => ({})));
  if (!r.success)
    throw new HttpError(
      400,
      r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  return r.data;
};
