# Engine · Quy tắc review migration

Cập nhật: 2026-11-09 · Gộp từ: cr120-invariants (đợt cr125-wave).

## Yêu cầu: Migration bảng thay thế phải backfill (nguồn: cr120-invariants)
Migration thêm bảng thay/chồng lên bảng khác phải kèm backfill, test backfill và quyết định rõ về code ghi bảng cũ; reviewer chặn nếu thiếu.
- Kịch bản: khi review gặp migration thêm bảng thay bảng khác mà không có backfill hoặc test backfill hoặc quyết định writer cũ thì đánh Blocker [test: thủ công — quy tắc review (.claude/agents/reviewer.md nhóm 4, docs/CONVENTIONS.md §8)]
