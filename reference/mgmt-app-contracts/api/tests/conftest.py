import os

os.environ["FAKE_LLM"] = "true"
# Own indices and own Neo4j: a test reset never wipes dev data. Override to run two suites side by side.
# Under pytest-xdist (`-n 2`, pyproject addopts) worker gwN gets indices "test_gwN_" and the Neo4j at 7688+N
# (neo4j-test, neo4j-test2: scripts/dev-db.ps1), so workers never wipe each other.
_worker = os.environ.get("PYTEST_XDIST_WORKER", "")
_n = int(_worker[2:]) if _worker.startswith("gw") else 0
os.environ["INDEX_PREFIX"] = os.environ.get("TEST_INDEX_PREFIX", "test_") + (f"{_worker}_" if _worker else "")
os.environ["NEO4J_URI"] = os.environ.get("TEST_NEO4J_URI", f"bolt://127.0.0.1:{7688 + _n}")
os.environ["REMIND_ENABLED"] = "false"   # the reminder job must not fire inside TestClient lifespans
os.environ["FOLLOWUPS_ENABLED"] = "false"   # tests deliver reminders themselves (deliver_due with a fixed time)
os.environ["ASSISTANT_BACKEND"] = "api"  # never the real Claude CLI from tests (test_assistant_cli fakes it)
os.environ["RESEARCH_BACKEND"] = "off"
os.environ["OPEN_SIGNUP"] = "true"        # most tests sign people up; test_signup_closed checks the production default

for _k in ("GDRIVE_SA_JSON", "GDRIVE_FOLDER_ID", "SLACK_BOT_TOKEN", "SLACK_CHANNELS",
           "JIRA_BASE_URL", "JIRA_API_TOKEN", "JIRA_PROJECTS", "SMTP_HOST"):
    os.environ[_k] = ""  # never start real pollers or send mail from a developer's .env during tests



def _start_local_dbs() -> None:
    """On a Windows dev machine the databases run outside Docker (scripts/dev-db.ps1). Start them when they are not
    answering instead of failing every test with "connection refused"; the script starts nothing twice."""
    import socket
    import subprocess
    import sys
    from pathlib import Path

    def up(port: int) -> bool:
        with socket.socket() as s:
            s.settimeout(0.3)
            return s.connect_ex(("127.0.0.1", port)) == 0
    script = Path(__file__).resolve().parents[2] / "scripts" / "dev-db.ps1"
    if sys.platform != "win32" or not script.exists() or os.environ.get("TEST_NEO4J_URI"):
        return
    if not (up(9200) and up(7688 + _n)):
        subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), "-Wait"],
                       check=True, timeout=240)


_start_local_dbs()

import pytest  # noqa: E402

from app import auth  # noqa: E402
from app.main import app  # noqa: E402
from app.store import graph, opensearch  # noqa: E402

import httpx2  # noqa: E402

from app.companies import registry  # noqa: E402


def _registry_down(req):
    raise httpx2.ConnectError("tests never reach VietQR")


registry._client = httpx2.Client(transport=httpx2.MockTransport(_registry_down))   # tests that care install answers
registry.INTERVAL = 0

TEST_ADMIN = {"email": "admin@test.local", "name": "Test Admin", "role": "admin",
              "manager_email": None, "active": True}
app.dependency_overrides[auth.current_user] = lambda: TEST_ADMIN


def _ensure_test_org():
    """The suite-wide admin owns an organisation, so contract routes see what the tests upload."""
    from app import orgs
    if not orgs.membership(TEST_ADMIN["email"]):
        orgs.create_org("Test Org", TEST_ADMIN["email"])


@pytest.fixture(scope="session", autouse=True)
def clean_stores():
    opensearch.reset()
    graph.reset()
    _ensure_test_org()
    yield


@pytest.fixture(scope="module")
def fresh_stores():
    opensearch.wipe()                 # empty, not recreated: the session fixture already built every index
    graph.reset()
