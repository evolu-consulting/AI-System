// HUB-FR-68 · HUB-BR-30 · D4: sau settle (thành công hoặc lỗi) cache mutation không còn `value`.
import { expect, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { runGuarded, secretMutationOptions } from "./use-secret-mutations";

const SECRET = "sk-unit-Zx9Pq7Lm-secret";
// Thăm dò tới khi điều kiện đúng (tối đa 1s) — không chờ cố định; hết hạn thì để assertion báo lỗi.
async function waitFor(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
}

async function run(fail: boolean) {
  const qc = new QueryClient();
  const obs = new MutationObserver(qc, {
    ...secretMutationOptions,
    mutationFn: async (_v: { value: string }) => {
      if (fail) throw new Error("boom");
      return { version: 1 };
    },
  });
  const res = runGuarded(
    { mutateAsync: (v: { value: string }) => obs.mutate(v), reset: () => obs.reset() },
    { value: SECRET },
  );
  if (fail) await expect(res).rejects.toThrow("boom");
  else await res;
  const snap = () =>
    JSON.stringify(
      qc
        .getMutationCache()
        .getAll()
        .map((m) => m.state.variables ?? null),
    );
  await waitFor(() => !snap().includes(SECRET));
  return snap();
}

test("HUB-BR-30 · thành công: cache mutation không còn giá trị", async () => {
  expect(await run(false)).not.toContain(SECRET);
});
test("HUB-BR-30 · lỗi: cache mutation không còn giá trị", async () => {
  expect(await run(true)).not.toContain(SECRET);
});
