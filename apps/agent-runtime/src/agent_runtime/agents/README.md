# agents/ — loại agent nội bộ (WRK-FR-25)

| File | Nội dung |
|---|---|
| `base.py` | `AgentType`: `key`, `runtime`, mô tả vi/en, `version`, `Config` (pydantic → `config_schema`) |
| `agentic_cli.py` | `AgenticCli` — loại duy nhất của H1 |
| `manifest.py` | registry: gom mọi class con `AgentType` trong `agents/` → `manifests()` (ghi lúc khởi động) |

Thêm loại = thêm module có class con. Không import `db`/`events` (import-linter).
