"""Headless test launcher — runs the KH FastAPI app on a test port against an
isolated copy of prod data. NOT the tray build. Env (paths + port) is set by the
caller before this imports `main` (module import opens Chroma at CHROMA_PATH)."""
import os
import uvicorn

# Import AFTER env is set so config.py picks up the test paths.
from main import app  # noqa: E402

if __name__ == "__main__":
    host = os.getenv("KH_HOST", "127.0.0.1")
    port = int(os.getenv("KH_PORT", "9200"))
    uvicorn.run(app, host=host, port=port, log_level="info")
