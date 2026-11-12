// CR-102 · C5 · giao diện API mà UI dùng. Hai adapter: `mock` (in-memory, chạy ngay) và `http` (C3 nối `/pack/community/*`).
// Hình dữ liệu = `@ai/contracts/community`. UI không lọc quyền xem: mọi thứ do adapter/server quyết.
import type {
  CommentPage,
  CommentView,
  CommunityBrand,
  CommunityFile,
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
  Mention,
  ModerationItem,
  ModerationList,
  PartnerOrg,
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

/** CR-120 · 3 luồng Community (`/pack/community/{moderation,join-requests,reports,posts/:id/report,flows/nav}`). Mỗi danh sách = MỘT yêu cầu (server giới hạn 100). */
export interface FlowsApi {
  nav(): Promise<FlowNav>;
  modQueue(): Promise<ModerationList>;
  myModeration(): Promise<ModerationList>;
  decideModeration(id: string, input: FlowDecideInput): Promise<ModerationItem>;
  createJoin(input: JoinRequestInput): Promise<JoinRequest>;
  listJoins(pendingOnly: boolean): Promise<JoinRequest[]>;
  decideJoin(id: string, input: FlowDecideInput): Promise<JoinRequest>;
  /** Đối tác SHT để gắn khi duyệt yêu cầu tham gia (`GET /pack/contracts/partners/search`, sổ đối tác — gồm cả đối tác chưa có HĐ); lỗi/gói tắt ⇒ chỉ còn «Tạo đối tác mới». */
  listParties(q?: string): Promise<{ party: string; name: string }[]>;
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
  /** `GET /pack/community/posts/:id/comments` — danh sách phẳng cũ → mới, server lọc theo người xem; `cursor` = trang kế. */
  listComments(postId: string, cursor?: string): Promise<CommentPage>;
  /** `GET /pack/community/posts/:id/mentionables?q=` — công ty nhắc (@) được trên bài này (đối tác: rỗng). */
  listMentionables(postId: string, q?: string): Promise<Mention[]>;
  /** `POST /pack/community/posts/:id/comments` — `mentions` = id công ty (≤ 10); ngoài tập cho phép ⇒ 422 MENTION_NOT_ALLOWED. */
  addComment(postId: string, input: CreateCommentInput): Promise<CommentView>;
  /** `PATCH /pack/community/posts/:id/comments/:cid` — người viết sửa chữ. */
  editComment(postId: string, commentId: string, text: string): Promise<CommentView>;
  /** `DELETE /pack/community/posts/:id/comments/:cid` — người viết xoá (204). */
  deleteComment(postId: string, commentId: string): Promise<void>;
  /** `POST /pack/community/posts/:id/comments/:cid/hide` — chủ quản ẩn/hiện (bài của mình). */
  hideComment(postId: string, commentId: string, hidden: boolean): Promise<CommentView>;
  /** `GET /pack/community/partners` — chủ quản: bạn bè; đối tác: [công ty mình]. */
  listPartners(opts?: { rep?: boolean }): Promise<PartnerOrg[]>;
  /** `GET /pack/community/profile/:orgId/media` — ảnh & tệp của bài người xem được thấy (CR-110 COM-FR-37). */
  getProfileMedia(orgId: string, q?: { cursor?: string; limit?: number }): Promise<ProfileMedia>;
  /** `GET /pack/community/cats` — nhóm hàng để gắn bài / chọn người xem. */
  listCats(): Promise<string[]>;
  /** `GET /pack/community/profile/:orgId?` */
  getProfile(orgId?: string): Promise<Profile>;
  /** `GET|PUT /pack/community/settings` */
  getSettings(): Promise<CommunitySettings>;
  saveSettings(s: CommunitySettings): Promise<CommunitySettings>;
  /** Trợ lý giá (C10b) — chỉ chủ quản; đối tác không có. */
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
  /** `GET /pack/community/files/:fileId` ⇒ object URL của ảnh (Bearer); NGƯỜI GỌI thu hồi bằng `URL.revokeObjectURL`. */
  fileObjectUrl(fileId: string): Promise<string>;
}
