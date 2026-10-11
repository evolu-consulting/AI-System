import runpy, traceback
import agent_runtime.sources.snapshot as _s
_s._DIR_MODE = 0o755  # UAT workaround: bug os.replace(dir 0555) EACCES khi Runtime không-root
import agent_runtime.runtimes.cli.runner as r
_orig = r.get_logger
class P:
    def __init__(s, l): s.l = l
    def error(s, ev, **kw):
        if ev == "job.host_failed": traceback.print_exc()
        return s.l.error(ev, **kw)
    def __getattr__(s, n): return getattr(s.l, n)
r.get_logger = lambda *a, **k: P(_orig(*a, **k))
runpy.run_module("agent_runtime", run_name="__main__")
