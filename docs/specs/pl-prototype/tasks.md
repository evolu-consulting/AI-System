# pl-prototype — bước tùy chọn «Bản mẫu bấm được» (công cụ dây chuyền, làn nhanh)

## Quyết định
- `tools/prototype/`: `schema.ts` (zod), `render.ts` (`renderPrototype`, thuần, escape mọi chữ), `build.ts` (CLI). `bun run proto:build docs/specs/<CR>` đọc `prototype.json` → ghi `prototype.html` (một file, không gọi mạng).
- Token màu/bo góc/phông chép từ `packages/web-kit/src/styles/tokens.css`; sáng/tối theo `prefers-color-scheme`.
- Skill `.claude/skills/prototype/SKILL.md`; ví dụ: `prototype.json` + `prototype.html` cùng thư mục này.
- Bản mẫu là đồ bỏ đi; spec mới là nguồn sự thật.

## Việc
- [x] schema + render + CLI + unit test
- [x] skill + ví dụ «Gửi đối tác xác nhận»

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: công cụ dây chuyền, không đổi sản phẩm)
Trạng thái gộp: chưa gộp
