# services/

Dịch vụ Python chạy cạnh AI-System, ngoài bun workspace (không nằm trong turbo, biome, `bun test`, `check:size`).

| Thư mục | Nội dung | Nguồn |
|---|---|---|
| `dlc/` | AI SDLC (DLC) engine, bản fork Dify: process cấu hình trong Dify (`line/difyproc.py`), bộ test Dify local ở `e2e/dify/` | NghiepHoang91/RWorkspace `Slaves/SDLC` @ `88df2ae` |
| `knowledge-hub/` | Knowledge Hub (KH) | NghiepHoang91/RWorkspace `Slaves/KnowledgeHub` @ `88df2ae` |

AI-System gọi DLC engine qua REST từ `apps/agent-runtime/src/agent_runtime/runtimes/dlc` (provider `dlc`).

Test: `cd services/dlc && python -m pytest line/tests`; `cd services/knowledge-hub && python -m pytest tests`.
