# final-green2 · đưa mọi cổng repo về xanh sau đợt merge s2-backup/pack-boundary/chat-fast/chat-fast2/app-catalog

Làn nhanh. Quyết định:
- depcruise `component-no-fetch` (contracts-web, admin-web): gọi API chuyển vào `features/<f>/hooks/*`; component chỉ dùng hook/props. Không đổi luật.
- depcruise `ca-*` tenant-onboard: tách zod sang `adapters/onboard.schema.ts`, cổng `application/ports.ts`, nối ở `tenant-onboard.run.ts` (`onboardTenant(db, spec, actor)` giữ nguyên chữ ký). Test khoá NITI đổi đường dẫn import (qc).
- depcruise `no-cross-module-repo`: identity-import gọi `packs.service.grantAgentsAndNotify` thay vì `packs.repo`.
- check:fn / check:size: tách hàm/describe/file (job-agent-runner.types.ts, filebox fb_core.py + fb_upload.py, Dockerfile COPY cập nhật).
- Test khoá V2-O/demo-ai-fix: 2 tài liệu (demo + QC-TC-01), 6 đoạn; relock.
