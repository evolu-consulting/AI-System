// CR-102 · C3 · adapter HTTP thật: `/pack/community/*` của hub-api (proxy cùng origin), Bearer từ phiên contracts (web-kit:
// token trong bộ nhớ, 401 ⇒ refresh cookie một lần). Hình dữ liệu = `@ai/contracts/community`; server quyết quyền xem.
import type { FeedQuery } from "@ai/contracts/community";
import { api } from "@ai/web-kit/http";
import type { CommunityApi } from "./client";
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

export function createHttpApi(): CommunityApi {
  return {
    getViewer: () => api(`${BASE}/viewer`),
    listFeed: (q) => api(`${BASE}/feed`, { query: feedQueryString(q) }),
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
    listPartners: () => api(`${BASE}/partners`),
    updatePartner: (orgId, input) =>
      api(`${BASE}/partners/${enc(orgId)}`, { method: "PUT", body: input }),
    listCats: () => api(`${BASE}/cats`),
    getProfile: (orgId) => api(orgId ? `${BASE}/profile/${enc(orgId)}` : `${BASE}/profile`),
    getSettings: () => api(`${BASE}/settings`),
    saveSettings: (s) => api(`${BASE}/settings`, { method: "PUT", body: s }),
    chat: { createConversation, send: sendAndStream, cancel: cancelRun },
  };
}
