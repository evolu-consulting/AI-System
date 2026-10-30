"""Entry point: python -m todo --file PATH COMMAND [ARGS].

Each command lives in its own module todo/cmd_<command>.py with run(path, args) -> exit code.
"""

import importlib
import sys


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) < 3 or argv[0] != "--file":
        sys.stderr.write("usage: python -m todo --file PATH COMMAND [ARGS]\n")
        return 2
    path, command, args = argv[1], argv[2], argv[3:]
    if not command.isidentifier():
        sys.stderr.write("error: unknown command %s\n" % command)
        return 2
    try:
        mod = importlib.import_module("todo.cmd_" + command)
    except ImportError:
        sys.stderr.write("error: unknown command %s\n" % command)
        return 2
    return int(mod.run(path, args) or 0)


if __name__ == "__main__":
    sys.exit(main())
