// CR-102 · C5 · giao diện API mà UI dùng. Hai adapter: `mock` (in-memory, chạy ngay) và `http` (C3 nối `/pack/community/*`).
// Hình dữ liệu = `@ai/contracts/community`. UI không lọc quyền xem: mọi thứ do adapter/server quyết.
import type { ChatEvent, SendMessageRequest } from "@ai/contracts/chat";
import type {
  CommunityBrand,
  CommunityFile,
  CommunityNotification,
  CommunitySettings,
  CommunityViewer,
  CreateCommentInput,
  CreatePostInput,
  FeedQuery,
  FeedResponse,
  FlowDecideInput,
  FlowNav,
  JoinRequest,
  JoinRequestInput,
  ModerationItem,
  ModerationList,
  PartnerOrg,
  PartnerUpdateInput,
  PostActionInput,
  PostSource,
  PostView,
  Profile,
  ProfileMedia,
  QuoteInput,
  QuoteMatch,
  QuotePreview,
  QuoteSaved,
  Report,
  Thread,
  ThreadSummary,
  UpdatePostInput,
} from "@ai/contracts/community";
import type { Parsed, Route } from "../domain/route";

/** Cổng định tuyến do app chủ cấp (router gộp CR-118 hoặc vỏ mỏng tạm của community-web); module không biết `location`. */
export interface RouterPort {
  /** Route + cờ Cài đặt hiện tại. */
  read(): Parsed;
  /** Chuyển route (thêm mục lịch sử). */
  go(r: Route): void;
  /** Thay route hiện tại (không thêm mục lịch sử) — đóng hộp thoại Cài đặt. */
  replace(r: Route): void;
  /** `href` cho thẻ `<a>` tới route. */
  href(r: Route): string;
  /** Báo khi URL đổi (back/forward, link); trả hàm huỷ. */
  subscribe(cb: () => void): () => void;
}

export type DockSent = { runId: string | null; flowId: string | null };
/** com-c10b · cổng trợ lý giá (Agent Hub, SSE). http = `/conversations`+`/runs` (X-Ai-Surface: community); mock = trả lời mẫu. */
export interface DockChat {
  createConversation(title: string): Promise<{ id: string }>;
  send(convId: string, req: SendMessageRequest, onEvent: (e: ChatEvent) => void): Promise<DockSent>;
  cancel(runId: string): Promise<void>;
}

/** CR-120 · 3 luồng Community (`/pack/community/{moderation,join-requests,reports,posts/:id/report,flows/nav}`). Mỗi danh sách = MỘT yêu cầu (server giới hạn 100). */
export interface FlowsApi {
  nav(): Promise<FlowNav>;
  modQueue(): Promise<ModerationList>;
  myModeration(): Promise<ModerationList>;
  decideModeration(id: string, input: FlowDecideInput): Promise<ModerationItem>;
  createJoin(input: JoinRequestInput): Promise<JoinRequest>;
  listJoins(pendingOnly: boolean): Promise<JoinRequest[]>;
  decideJoin(id: string, input: FlowDecideInput): Promise<JoinRequest>;
  reportPost(postId: string, reason: string): Promise<Report>;
  listReports(pendingOnly: boolean): Promise<Report[]>;
  decideReport(id: string, input: FlowDecideInput): Promise<Report>;
}

export interface CommunityApi {
  flows: FlowsApi;
  /** `GET /pack/community/viewer` (C3: `/pack/:k/me` của kit đã chiếm `/me`). */
  getViewer(): Promise<CommunityViewer>;
  /** `GET /pack/community/brand` — brand công ty chủ quản, mọi vai kể cả đối tác (CR-110 COM-FR-45). */
  getBrand(): Promise<CommunityBrand>;
  /** `GET /pack/community/feed` */
  listFeed(q: FeedQuery): Promise<FeedResponse>;
  /** `POST /pack/community/posts` */
  createPost(input: CreatePostInput): Promise<PostView>;
  /** `PATCH /pack/community/posts/:id` */
  updatePost(id: string, input: UpdatePostInput): Promise<PostView>;
  /** `POST /pack/community/posts/:id/actions` — delete trả void. */
  postAction(id: string, input: PostActionInput): Promise<PostView | null>;
  /** `GET /pack/community/posts/:id/source` — bản gốc cho chính người đăng (HT-52), dùng khi sửa. */
  getPostSource(id: string): Promise<PostSource>;
  /** `GET /pack/community/posts/:id/threads` (chủ quản: mọi luồng; đối tác: luồng của mình). */
  listThreads(postId: string): Promise<ThreadSummary[]>;
  /** `GET /pack/community/posts/:id/threads/:orgId` */
  getThread(postId: string, orgId: string): Promise<Thread>;
  /** `POST /pack/community/posts/:id/comments` */
  addComment(postId: string, input: CreateCommentInput): Promise<Thread>;
  /** `PATCH /pack/community/posts/:id/comments/:cid` — người viết sửa; trả luồng. */
  editComment(postId: string, commentId: string, text: string): Promise<Thread>;
  /** `DELETE /pack/community/posts/:id/comments/:cid` — người viết xoá; trả luồng. */
  deleteComment(postId: string, commentId: string): Promise<Thread>;
  /** `POST /pack/community/posts/:id/comments/:cid/hide` — chủ quản ẩn/hiện (bài của mình). */
  hideComment(postId: string, commentId: string, hidden: boolean): Promise<Thread>;
  /** `GET /pack/community/notifications` */
  listNotifications(): Promise<{ items: CommunityNotification[]; unread: number }>;
  /** `POST /pack/community/notifications/read` (không id = tất cả). */
  markRead(id?: string): Promise<void>;
  /** `GET /pack/community/partners` — chủ quản: bạn bè; đối tác: [công ty mình]. */
  listPartners(opts?: { rep?: boolean }): Promise<PartnerOrg[]>;
  /** `GET /pack/community/profile/:orgId/media` — ảnh & tệp của bài người xem được thấy (CR-110 COM-FR-37). */
  getProfileMedia(orgId: string, q?: { cursor?: string; limit?: number }): Promise<ProfileMedia>;
  /** `PUT /pack/community/partners/:orgId` — chỉ Admin chủ quản (nhãn, nhóm hàng, liên kết SHT). */
  updatePartner(orgId: string, input: PartnerUpdateInput): Promise<PartnerOrg>;
  /** `GET /pack/community/cats` — nhóm hàng để gắn bài / chọn người xem. */
  listCats(): Promise<string[]>;
  /** `GET /pack/community/profile/:orgId?` */
  getProfile(orgId?: string): Promise<Profile>;
  /** `GET|PUT /pack/community/settings` */
  getSettings(): Promise<CommunitySettings>;
  saveSettings(s: CommunitySettings): Promise<CommunitySettings>;
  /** Trợ lý giá (C10b) — chỉ chủ quản; đối tác không có. */
  chat: DockChat;
  /** `POST /pack/community/posts/:id/quote/preview` — chỉ chủ quản; so giá + cảnh báo, không ghi. */
  previewQuote(postId: string, input: QuoteInput): Promise<QuotePreview>;
  /** `POST /pack/community/posts/:id/quote` — Lưu báo giá vào SP & Giá (chỉ chủ quản). */
  saveQuote(postId: string, input: QuoteInput): Promise<QuoteSaved>;
  /** `GET /pack/community/quote/match?q=` — SP khớp tên gõ + giá/tồn (chỉ chủ quản). */
  matchProduct(q: string): Promise<QuoteMatch>;
  /** `POST /pack/community/files` (thân thô + `X-Filename` percent-encode): server quét MIME, giới hạn cỡ/loại; lỗi ném object có `status`. */
  uploadFile(file: File): Promise<CommunityFile>;
  /** `GET /pack/community/files/:fileId` — tải về (cần Bearer nên không dùng `<a href>` trần). */
  downloadFile(fileId: string, name: string): Promise<void>;
}
