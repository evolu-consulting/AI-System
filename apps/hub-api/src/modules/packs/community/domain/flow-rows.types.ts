// CR-120 · cr120-community-flows · hình dạng hàng của 3 khe Community (kiểu thuần; SQL ở `adapters/flows.repo.ts`).
import type { JoinViewRow, ModViewRow, ReportViewRow } from "./flow-view.rules";

export type ModPostRow = ModViewRow & {
  type: "sell" | "buy" | "note";
  author_org: string | null;
  author_user_id: string;
  author_name: string;
  title: string;
  title_masked: string;
  body: string;
  product: string | null;
  created_at: string;
};

export type JoinRow = JoinViewRow & {
  requester_user_id: string;
  requester_org: string;
  contact: string;
  email: string;
  reason: string;
  labels: ("supplier" | "buyer")[];
};

export type ReportRow = ReportViewRow & {
  post_id: string;
  post_title: string;
  reporter_user_id: string;
  reason: string;
  created_at: string;
};
