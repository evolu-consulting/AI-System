import { useQuery } from "@tanstack/react-query";
import type { Tone } from "@/components/ui";
import { api, qs, send } from "./client";

/** One row of the contract list on p01, composed by the server (GET /board/contracts, PLAN T12). */
export type BoardRow = {
  id: string; title: string; party: string | null; sub: string | null;
  tags: { label: string; grey?: boolean }[];
  /** "Chữ ký số" contracts link to their signatures or their remaining stock instead of category tags. */
  cks: { label: string; href: string } | null;
  /** `code`: what the status is (api/app/board.py _status), for grouping; label and tone are how it is shown */
  status: { label: string; tone: Tone; code?: string };
  category_ids: string[];
  number: string | null; seller: string | null; buyer: string | null; value: number | null;
  /** our side: we sell (sale) or buy (purchase); null while the contract does not say which party is us */
  direction?: "sale" | "purchase" | null;
  /** when it ends (a CKS sale: when its signatures expire), ISO */
  end: string | null;
  /** who signs for each side, as the contract names them ("Nguyễn Văn A – Giám đốc") */
  seller_signer: string | null; buyer_signer: string | null;
  /** the person in charge (their name, or email when they have none) */
  owner: string | null;
};
export type Category = { id: string; name: string; product_count: number };

export const useBoard = (category: string) =>
  useQuery({ queryKey: ["board", category], queryFn: () => api<BoardRow[]>(`/board/contracts${qs({ category: category === "all" ? null : category })}`) });

export const useCategories = () => useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/categories") });
export const createCategory = (name: string) => api<Category>("/categories", send({ name }));

/** Remove a contract and everything projected from it (owner only; the API returns 403 otherwise). */
export const deleteContract = (id: string) => api<{ ok: boolean }>(`/contracts/${id}`, { method: "DELETE" });

export async function uploadContract(file: File) {
  const f = new FormData();
  f.append("file", file);
  return api<{ id: string }>("/contracts/upload", { method: "POST", body: f });
}
