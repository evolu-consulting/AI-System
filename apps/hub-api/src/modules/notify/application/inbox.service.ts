// N3-FR-04 · N3-FR-09 · nghiệp vụ chuông/tùy chọn của CHÍNH người dùng (tenant + user lấy từ token, không từ body/query).
// Không biết HTTP. Mọi hàm là một lời gọi kho (một tx RLS theo user).
import type { InboxStore, NotificationItem, Prefs, Who } from "./ports";

export type InboxPage = { items: NotificationItem[]; unread: number; next_before: number | null };

export class InboxService {
  constructor(private readonly store: InboxStore) {}

  async list(who: Who, limit: number, before: number | null): Promise<InboxPage> {
    const { items, unread } = await this.store.list(who, limit, before);
    // Trang đầy ⇒ có thể còn nữa: con trỏ = seq hàng cuối.
    const last = items[items.length - 1];
    return { items, unread, next_before: items.length === limit && last ? last.seq : null };
  }

  markRead(who: Who, ids: readonly string[] | "all"): Promise<number> {
    return this.store.markRead(who, ids);
  }

  prefs(who: Who): Promise<Prefs> {
    return this.store.prefs(who);
  }

  setPrefs(who: Who, p: Prefs): Promise<Prefs> {
    return this.store.setPrefs(who, p);
  }

  subscribe(who: Who, s: { endpoint: string; p256dh: string; auth: string }): Promise<void> {
    return this.store.subscribe(who, s);
  }

  unsubscribe(who: Who, endpoint: string): Promise<number> {
    return this.store.unsubscribe(who, endpoint);
  }
}
