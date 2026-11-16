---
id: cr177-w3b-buttons
lát: cr177-w3b-buttons
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

## Làm
- Nút trần có vai rõ (ghost/primary/outline/btn-*/link) ở community, settings, partners, shell, shared => kit Button; nút chỉ icon + title => IconButton (kit Button icon + Tooltip).

## Không làm / Chạm

## Test tối thiểu
- bun test apps/workspace-web, tsc, biome, check:ui-kit.

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-16 (đợt cr177-180)

Không thay đổi hành vi (lý do: chỉ đổi thành phần nút/tooltip sang bộ chung, giữ câu chữ, data-testid, aria).

Màn đã đổi:
Bảng tin (CategoryDialog, CommentItem, CompanyPicker, Composer, Feed, flows, MentionPicker, PostCard, QuoteForm, profile, Thread), Cài đặt (Delegation, FlowCurrent, FlowWork, Scoring, LoadState), Đối tác (AddCompany, ContactEditor, ContractsTab, CriterionJobs, FlagPanel, InternetSearch, NotesPanel, PartnerHeader, Ratings, PartnersPage), khung app (Header icon + tooltip), FileUploadField, PdfPane.

## Việc còn lại
- Còn nút trần dạng tab/chip/menu-item/ô chọn tự dựng (PostMenu, UserMenu, DockTabs, RepPane, AccentPicker, PersonSearchSelect, settings-layout, AssistantFab, pop-menu...) và nút Tailwind tự tạo (CompanyPane, CritTab, BizPane, TypesTab, AssistantPanel, assistant Composer) cần ToggleGroup/Tabs/Menu hoặc quyết định biến thể.
- title= còn ở TruncText, Tag, Sidebar, RepBadge, CriterionJobs, Highlighted, pop-menu (chữ cắt/chip, cần Tooltip cho chữ cắt).
- Kit thiếu: không có icon cho ★ ⚑ ‹ › trong icons.ts.

