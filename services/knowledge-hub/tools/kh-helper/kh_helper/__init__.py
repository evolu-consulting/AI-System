"""Knowledge Hub helper: signs a person in and calls KH on their behalf without exposing tokens."""
import time

STARTED = time.monotonic()     # when this helper process started; the MCP start-up deadline counts from here
