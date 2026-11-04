---
id: cr118-move
lát: cr118-move
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-spec
---
## Plan (ngắn)
1. `git mv apps/contracts-web apps/sohoptac-web` (@ai/sohoptac-web, giữ cổng 3300, giữ thư mục e2e `e2e/contracts-web` + tên job `contracts-web` — lát cr118-e2e đổi sau).
2. React 18.3.1 → 19.3.1 (+ @types/react 19.3.0, @types/react-dom 19.3.0) cho sohoptac-web, community-web và cả admin-web/chat-web/studio-web/web-kit; bật React Compiler 1.0 cho sohoptac-web.
3. Khung thư mục đích (rỗng) + `modules/contracts/manifest.ts` + 6 luật depcruise web-module.

## Làm
- Đổi tên + sửa tham chiếu: package.json, tsconfig.depcruise.json, Dockerfile build web (`--cwd apps/sohoptac-web`, dist vẫn `/srv/contracts`), done-n1.rules, test-affected.rules (`apps/sohoptac-web` → e2e contracts-web + N1), playwright configs (`--filter @ai/sohoptac-web`), dev-up.ps1, docs/CODEMAP, guides/deploy, current/README, TECH-DEBT; `bun install` (bun.lock), `test:lock:write` (tests/.lock: 3 playwright config + test sửa).
- React 19: `RefObject<T | null>`, `JSX` import từ react, `t()` kiểu mới (admin Fields.tsx), test SSR `readOnly` (chat-web LoginForm), đường dẫn push-sw của web-kit test.
- React Compiler: `@rsbuild/plugin-babel` 2.1.0 + `babel-plugin-react-compiler` 1.0.0 (pin chính xác), `include: /\.(?:jsx|tsx)$/`, bỏ `node_modules`, không cần react-compiler-runtime (React 19).
- Khung: `src/{shell,platform/{auth,features,brand,i18n},shared/{kernel,ui},modules/contracts}` (`app/`, `routes/` đã có), `shared/kernel/module-manifest.ts` (kiểu ModuleManifest), `modules/contracts/manifest.ts` trỏ NAV hiện có + unit.
- depcruise (`.dependency-cruiser.cjs`): web-mod-no-cross-module, web-shell-manifest-only (+ web-modules-no-shell, chiều ngược), web-domain-pure, web-ui-no-adapters, web-features-port-only = warn; web-business-no-other-web = error (bỏ qua cạnh "aliased" vì `~/*` trỏ cả chat-web).

## Không làm / Chạm
- Không dời code contracts vào modules/ (lát sau). Không đụng DLC. Không đổi hành vi. Không chụp lại baseline ảnh.
- Chạm admin-web/chat-web/studio-web/web-kit CHỈ vì React dùng chung một bản (web-kit là gói chung; hai bản React ⇒ hook lỗi).

## Test tối thiểu
- typecheck: web-kit, sohoptac-web, community-web, admin-web, chat-web, studio-web = 0 lỗi.
- unit (bun test) cả 6 gói xanh; build cả 5 web ok; depcruise: 0 vi phạm luật web-* mới ở mức error.
- e2e contracts-web chạy MỘT lần trên evotest cuối lát (kết quả ở báo cáo).

## Quyết định trong lúc làm
- Chọn React 19.3.1: bản ổn định mới nhất trên npm (latest), phát hành 2026-10-14 (≥ 3 tuần trước 2026-11-04), react-dom 19.3.1 cùng ngày; @types/react 19.3.0 + @types/react-dom 19.3.0 (2026-09-09, ≥ 8 tuần). Peer deps đã kiểm trên npm: TanStack Router 1.170.41 (`>=18`), Query 5.104.0 (`^18 || ^19`), radix-ui 1.6.7, @xyflow/react 12.11.6, sonner 2.0.8, lucide-react 1.49.0, react-hook-form 7.89.0, react-i18next 17.0.15, react-markdown 10.1.0 đều chấp nhận 19 ⇒ KHÔNG bump thư viện nào. Không dùng @testing-library (test SSR bằng react-dom/server) nên không có `act`. Không chọn 19.2.9 vì không có lý do kỹ thuật.
- React Compiler: tài liệu Rsbuild (guide/framework/react) khuyến nghị đường Rust `pluginReact({ reactCompiler: true })` (cần @rspack/core ≥ 2.1, có sẵn); điều phối yêu cầu đường babel plugin ⇒ dùng `babel-plugin-react-compiler` 1.0.0 (đúng bản "1.0"). Đổi sang đường Rust sau này chỉ là một dòng cấu hình.
- Giữ `e2e/contracts-web` và tên job `contracts-web` (đổi tên = churn 240 dòng lock; lát cr118-e2e trỏ lại).
- Ngân sách bundle (check:bundle) — CHƯA nới, để điều phối/qc quyết (test khoá `scripts/check-bundle.test.ts` mã cứng 150 KB): React 19 làm JS ban đầu tăng ~15 KB gzip ⇒ admin-web 165,2 · chat-web 166,8 · studio-web 176,6 (ngưỡng 160) · sohoptac-web 194,9 (không compiler) / 196,4 (có compiler; thêm 2 chunk 64–65 KB > 50); community-web 149,7 (đạt). Đề xuất: nâng ngưỡng JS +20 KB (+ chunk 70 KB cho sohoptac-web) và sửa fixture test tương ứng, hoặc cắt giảm.
- admin-web `Fields.tsx`: `t()` gán ra biến trước (kiểu trả về i18next + ReactNode của @types/react 19 làm overload lỗi) kèm `defaultValue`; khoá `process.admin.editor.choose` đã có sẵn.
- `~/*` của tsconfig.depcruise.json trỏ cả chat-web lẫn sohoptac-web ⇒ depcruise resolve nhầm alias sang chat-web khi trùng đường dẫn; các luật web-* khớp theo đường dẫn sohoptac-web nên không bị ảnh hưởng, rule 6 loại cạnh "aliased".

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: đổi tên thư mục/gói contracts-web → sohoptac-web + khung thư mục + luật depcruise chỉ là cấu trúc; nâng React 18.3.1 → 19.3.1 và bật React Compiler 1.0 là hạ tầng build, giao diện/luồng giữ nguyên — ảnh baseline e2e có thể lệch nhẹ do React 19, không recapture ở lát này)

## Việc còn lại
- check:bundle đỏ cho 4 web (xem Quyết định) — chờ điều phối/qc.
- Lát sau: dời features → modules/contracts/features, shell/platform/shared; đổi tên e2e/job.
