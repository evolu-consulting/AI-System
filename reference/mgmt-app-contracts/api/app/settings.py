from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../.env", extra="ignore")

    opensearch_url: str = "http://localhost:9200"
    opensearch_pool: int = 32            # connections kept open: about the number of requests served at once
    # Tests run against their own indices (prefix) and Neo4j, so they never touch dev data or each other's runs.
    index_prefix: str = ""
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "password123"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    fake_llm: bool = False
    claude_model: str = "claude-opus-5-5"
    # Assistant panel: Sonnet for everyday chat, Opus when a question needs analysis or many facts (assistant/route.py)
    assistant_model: str = "claude-sonnet-5-5"
    assistant_heavy_model: str = "claude-opus-5-5"
    assistant_light_model: str = "claude-haiku-5-5"   # picks tools, reads a single lookup back, structures research
    # Contracts: read straight from the PDF by Claude when ANTHROPIC_API_KEY is set (measured: 40/41 fields,
    # ~20 s and ~$0.005 per contract on the real sample), and scanned PDFs are transcribed by it too.
    contract_model: str = "claude-haiku-5-5"
    llm_provider: str = "anthropic"   # "anthropic" | "openai"
    openai_chat_model: str = "gpt-4.1"
    embed_model: str = "text-embedding-3-small"
    embed_dim: int = 1536
    gdrive_sa_json: str = ""
    gdrive_folder_id: str = ""
    gdrive_poll_seconds: int = 900
    slack_bot_token: str = ""
    slack_channels: str = ""
    slack_backfill_days: int = 90
    slack_thread_window_days: int = 7
    slack_poll_seconds: int = 900
    jira_base_url: str = ""
    jira_email: str = ""
    jira_api_token: str = ""
    jira_projects: str = ""
    jira_poll_seconds: int = 900
    rerank_model: str = "gpt-4.1-mini"
    rerank_enabled: bool = True
    # Calibrated against real OpenAI embeddings, not the fake hash embedder:
    # a paraphrased duplicate scores ~0.74 and unrelated text ~0.04, so 0.65
    # separates them with room; reversed names score ~0.77 while different
    # people score ~0.53, so 0.70 separates those and the LLM confirms.
    similar_threshold: float = 0.65
    resolve_threshold: float = 0.70
    admin_email: str = ""
    admin_password: str = ""
    session_days: int = 7
    cookie_secure: bool = False
    cors_origins: str = "http://localhost:3000"
    public_url: str = "http://localhost:3000"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_starttls: bool = True
    remind_enabled: bool = True
    # Pollers and the reminder tick run in exactly one process: on in dev/the "jobs" container, off in web workers.
    background_jobs: bool = True
    remind_hour: int = 8
    followups_enabled: bool = True       # "Hẹn nhắc": delivered at their minute (ledger/followups.py)
    app_logs_enabled: bool = True        # trial-phase activity log (app/audit.py)
    usage_log_enabled: bool = True       # every Claude call's tokens and cost, for the team (app/usage.py)
    # GET /admin/usage answers only with header X-Admin-Token equal to this; empty = the route is off. Not a user role:
    # customers, owners included, never see usage.
    admin_token: str = ""
    log_retention_days: int = 180
    remind_days: str = "60,30,7,1,0"
    # Web Push: generate once with `python -m app.contracts.push`; changing them orphans every browser subscription.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"
    # Contract site (cm-web): Google sign-in, one organisation per user, upload limits that cap Claude spend.
    google_client_id: str = ""
    # Off: nobody makes their own account or company. New companies are set up by us; an owner adds their people.
    # Turn on only together with e-mail verification, or anyone can open a company and invite in strangers' names.
    open_signup: bool = False
    cm_public_url: str = "http://localhost:3001"
    contract_max_mb: int = 20
    contract_daily_uploads_per_org: int = 30
    contract_daily_uploads_total: int = 300
    # "Góp ý về app": attachments on disk, one folder per submission
    feedback_dir: str = "data/feedback"
    # …and each one becomes a card on the team's Trello board (connectors/trello.py); empty key = kept in the app only
    trello_api_key: str = ""
    trello_token: str = ""
    trello_feedback_list_id: str = ""    # the board's "Mới" list: `python -m app.connectors.trello --setup` makes one
    chat_files_dir: str = "data/chat_files"   # images and files added in the assistant panel
    contract_files_dir: str = "data/contract_files"   # each contract's original file
    # Claude Code CLI signed in on the server: market-price research (WebSearch/WebFetch) and, with
    # ASSISTANT_BACKEND=cli, the assistant chat that may act for the user through the app's own API (assistant/cli.py).
    claude_bin: str = ""                 # empty: `claude` on PATH, then ~/.local/bin/claude
    research_backend: str = "cli"        # cli | api | off
    market_scans_per_day: int = 10       # per organisation: each scan is a few minutes of AI web research
    assistant_backend: str = "api"       # api: Messages API, proposals only · cli: Claude CLI, acts within the user's rights
    assistant_writes_per_chat: int = 5   # changes one question may make through the CLI assistant
    internal_api_url: str = "http://127.0.0.1:8000"   # how the CLI's tool server reaches this API


settings = Settings()
