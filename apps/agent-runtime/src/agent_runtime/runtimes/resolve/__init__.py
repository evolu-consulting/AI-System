"""P-b · PF-S2 · Job host `source.resolve` (process cha): claim → resolve từng item (git/local/
library) → `POST /internal/jobs/:id/sources-resolved` (Bearer job-token) → kết thúc job.
"""

from agent_runtime.runtimes.resolve.host import ResolveHost

__all__ = ["ResolveHost"]
