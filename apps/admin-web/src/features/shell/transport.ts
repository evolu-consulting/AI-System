// Client HTTP riêng của admin-web cho kit (kit không biết token của web này); tách khỏi component Topbar.
import { api, apiResponse } from "@/lib/http";

export const FEEDBACK_TRANSPORT = {
  request: api,
  blob: async (path: string) => (await apiResponse(path)).blob(),
};

export const NOTIFY_TRANSPORT = { request: api };
