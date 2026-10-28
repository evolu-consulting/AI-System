// CR-102 · C5 · giao diện API mà UI dùng. Hai adapter: `mock` (in-memory, chạy ngay) và `http` (C3 nối `/pack/community/*`).
// Hình dữ liệu = `@ai/contracts/community`. UI không lọc quyền xem: mọi thứ do adapter/server quyết.
import type {
  CommunityNotification,
  CommunitySettings,
  CommunityViewer,
  CreateCommentInput,
  CreatePostInput,
  FeedQuery,
  FeedResponse,
  PartnerOrg,
  PartnerUpdateInput,
  PostActionInput,
  PostSource,
  PostView,
  Profile,
  Thread,
  ThreadSummary,
  UpdatePostInput,
} from "@ai/contracts/community";

export type ChatReply = { text: string; source?: string };

export interface CommunityApi {
  /** `GET /pack/community/viewer` (C3: `/pack/:k/me` của kit đã chiếm `/me`). */
  getViewer(): Promise<CommunityViewer>;
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
  listPartners(): Promise<PartnerOrg[]>;
  /** `PUT /pack/community/partners/:orgId` — chỉ Admin chủ quản (nhãn, nhóm hàng, liên kết SHT). */
  updatePartner(orgId: string, input: PartnerUpdateInput): Promise<PartnerOrg>;
  /** `GET /pack/community/cats` — nhóm hàng để gắn bài / chọn người xem. */
  listCats(): Promise<string[]>;
  /** `GET /pack/community/profile/:orgId?` */
  getProfile(orgId?: string): Promise<Profile>;
  /** `GET|PUT /pack/community/settings` */
  getSettings(): Promise<CommunitySettings>;
  saveSettings(s: CommunitySettings): Promise<CommunitySettings>;
  /** Trợ lý giá (C10) — placeholder. */
  chatAsk(text: string): Promise<ChatReply>;
}
