// CR-102b · C7b · phần Lưu báo giá của adapter mock (in-memory; server thật quyết so giá/quyền).

import type { QuoteMark } from "@ai/contracts/community";
import type { CommunityApi } from "./client";

const MOCK_PRICES: Record<string, number> = { "mock-keo": 12_000 };

type Env = {
  isHost: () => boolean;
  marks: { postId: string; mark: QuoteMark }[];
  quotesOf: (postId: string) => { quotes?: QuoteMark[] };
};

export function quoteMock(
  env: Env,
): Pick<CommunityApi, "previewQuote" | "saveQuote" | "matchProduct"> {
  const found = (postId: string, idx: number) =>
    env.marks.find((m) => m.postId === postId && m.mark.itemIdx === idx);
  return {
    previewQuote: async (postId, input) => {
      if (!env.isHost()) throw new Error("403");
      const ex = found(postId, input.itemIdx ?? 0);
      const existing = ex ? { by: ex.mark.by, at: ex.mark.at } : null;
      const ref = MOCK_PRICES[input.productId ?? ""];
      if (!ref) return { compare: { kind: "first" }, warnings: [], replaces: 0, existing };
      const diff = input.price - ref;
      const pct = Math.round((diff / ref) * 1000) / 10;
      return {
        compare: {
          kind: diff === 0 ? "equal" : diff < 0 ? "cheaper" : "dearer",
          refPrice: ref,
          refSupplier: "NCC mẫu",
          diff,
          pct,
        },
        warnings: Math.abs(pct) > 30 ? [{ code: "deviation", pct, refPrice: ref }] : [],
        replaces: 0,
        existing,
      };
    },
    saveQuote: async (postId, input) => {
      if (!env.isHost()) throw new Error("403");
      const mark: QuoteMark = {
        itemIdx: input.itemIdx ?? 0,
        ...(input.commentId ? { commentId: input.commentId } : {}),
        by: "Bạn",
        at: new Date().toISOString(),
        productId: input.productId ?? "new-product",
        supplier: "Nhà cung cấp",
        price: input.price,
        unit: input.unit ?? null,
        postEdited: false,
        priceEdited: false,
      };
      const i = env.marks.findIndex(
        (m) =>
          m.postId === postId &&
          m.mark.itemIdx === mark.itemIdx &&
          m.mark.commentId === input.commentId,
      );
      if (i >= 0) env.marks.splice(i, 1);
      env.marks.push({ postId, mark });
      return {
        compare: { kind: "first" },
        warnings: [],
        replaces: 0,
        existing: null,
        productId: mark.productId,
        productCreated: input.productId === undefined,
        supplierCreated: false,
        mark,
      };
    },
    matchProduct: async (q) => ({
      hint: {
        match: q.toLowerCase().includes("keo")
          ? { productId: "mock-keo", name: "Băng keo 5cm", unit: "cuộn", how: "prefix" }
          : null,
        onHand: null,
        avgCost: null,
        best: null,
        reputation: null,
        inStock: false,
      },
    }),
  };
}

export const quoteEnvOf = (isHost: () => boolean): Env => ({
  isHost,
  marks: [],
  quotesOf(postId) {
    const q = this.marks.filter((m) => m.postId === postId).map((m) => m.mark);
    return q.length ? { quotes: q } : {};
  },
});
