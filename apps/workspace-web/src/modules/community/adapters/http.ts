// CR-102 · C3 · adapter HTTP thật: `/pack/community/*` của hub-api (proxy cùng origin), Bearer từ phiên contracts (web-kit:
// token trong bộ nhớ, 401 ⇒ refresh cookie một lần). Hình dữ liệu = `@ai/contracts/community`; server quyết quyền xem.
import type { FeedQuery, JoinRequest, Report } from "@ai/contracts/community";
import { api, apiResponse } from "@ai/web-kit/http";
import type { CommunityApi, FlowsApi } from "../application/ports";
import { cancelRun, createConversation, sendAndStream } from "./dock";

const BASE = "/pack/community";
const enc = encodeURIComponent;

/** Query bảng tin: bỏ giá trị rỗng; boolean/number thành chuỗi (server ép lại). */
export function feedQueryString(q: FeedQuery): Record<string, string | number | undefined> {
  return {
    tab: q.tab,
    cat: q.cat,
    area: q.area,
    authorOrgId: q.authorOrgId,
    q: q.q,
    mine: q.mine ? "true" : undefined,
    cursor: q.cursor,
    limit: q.limit,
  };
}

const pend = (p: boolean) => (p ? { query: { pending: "1" } } : undefined);
const post = (body: unknown) => ({ method: "POST" as const, body });

export const createHttpFlows = (): FlowsApi => ({
  nav: () => api(`${BASE}/flows/nav`),
  modQueue: () => api(`${BASE}/moderation/queue`),
  myModeration: () => api(`${BASE}/moderation/mine`),
  decideModeration: (id, input) => api(`${BASE}/moderation/${enc(id)}/decide`, post(input)),
  createJoin: (input) => api(`${BASE}/join-requests`, post(input)),
  listJoins: async (p) =>
    (await api<{ items: JoinRequest[] }>(`${BASE}/join-requests`, pend(p))).items,
  decideJoin: (id, input) => api(`${BASE}/join-requests/${enc(id)}/decide`, post(input)),
  reportPost: (postId, reason) => api(`${BASE}/posts/${enc(postId)}/report`, post({ reason })),
  listReports: async (p) => (await api<{ items: Report[] }>(`${BASE}/reports`, pend(p))).items,
  decideReport: (id, input) => api(`${BASE}/reports/${enc(id)}/decide`, post(input)),
});

export function createHttpApi(): CommunityApi {
  return {
    flows: createHttpFlows(),
    getViewer: () => api(`${BASE}/viewer`),
    getBrand: () => api(`${BASE}/brand`),
    listFeed: (q) => api(`${BASE}/feed`, { query: feedQueryString(q) }),
    uploadFile: (file) =>
      api(`${BASE}/files`, {
        method: "POST",
        rawBody: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": enc(file.name),
        },
      }),
    downloadFile: async (fileId, name) => {
      const blob = await (await apiResponse(`${BASE}/files/${enc(fileId)}`)).blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    },
    createPost: (input) => api(`${BASE}/posts`, { method: "POST", body: input }),
    updatePost: (id, input) => api(`${BASE}/posts/${enc(id)}`, { method: "PATCH", body: input }),
    postAction: async (id, input) =>
      (await api(`${BASE}/posts/${enc(id)}/actions`, { method: "POST", body: input })) ?? null,
    getPostSource: (id) => api(`${BASE}/posts/${enc(id)}/source`),
    listThreads: (postId) => api(`${BASE}/posts/${enc(postId)}/threads`),
    getThread: (postId, orgId) => api(`${BASE}/posts/${enc(postId)}/threads/${enc(orgId)}`),
    addComment: (postId, input) =>
      api(`${BASE}/posts/${enc(postId)}/comments`, { method: "POST", body: input }),
    editComment: (postId, id, text) =>
      api(`${BASE}/posts/${enc(postId)}/comments/${enc(id)}`, { method: "PATCH", body: { text } }),
    deleteComment: (postId, id) =>
      api(`${BASE}/posts/${enc(postId)}/comments/${enc(id)}`, { method: "DELETE" }),
    hideComment: (postId, id, hidden) =>
      api(`${BASE}/posts/${enc(postId)}/comments/${enc(id)}/hide`, {
        method: "POST",
        body: { hidden },
      }),
    listNotifications: () => api(`${BASE}/notifications`),
    markRead: async (id) => {
      await api(`${BASE}/notifications/read`, { method: "POST", body: id ? { id } : {} });
    },
    listPartners: (opts) =>
      api(`${BASE}/partners`, opts?.rep ? { query: { rep: "1" } } : undefined),
    getProfileMedia: (orgId, q) =>
      api(`${BASE}/profile/${enc(orgId)}/media`, { query: { cursor: q?.cursor, limit: q?.limit } }),
    updatePartner: (orgId, input) =>
      api(`${BASE}/partners/${enc(orgId)}`, { method: "PUT", body: input }),
    listCats: () => api(`${BASE}/cats`),
    getProfile: (orgId) => api(orgId ? `${BASE}/profile/${enc(orgId)}` : `${BASE}/profile`),
    getSettings: () => api(`${BASE}/settings`),
    saveSettings: (s) => api(`${BASE}/settings`, { method: "PUT", body: s }),
    chat: { createConversation, send: sendAndStream, cancel: cancelRun },
    previewQuote: (postId, input) =>
      api(`${BASE}/posts/${enc(postId)}/quote/preview`, { method: "POST", body: input }),
    saveQuote: (postId, input) =>
      api(`${BASE}/posts/${enc(postId)}/quote`, { method: "POST", body: input }),
    matchProduct: (q) => api(`${BASE}/quote/match`, { query: { q } }),
  };
}
