"""line.solo.keep_eol: an agent's CRLF saves of LF files do not turn a small change into a whole-file rewrite."""

import os
import shutil
import subprocess
import tempfile
import unittest

from line.solo import keep_eol


def git(repo, *args):
    return subprocess.run(["git", "-c", "core.autocrlf=false", "-C", repo, *args], capture_output=True, check=True)


class KeepEolTest(unittest.TestCase):
    def setUp(self):
        self.repo = tempfile.mkdtemp(prefix="eol-")
        git(self.repo, "init", "-q")
        for name, data in (("lf.js", b"a\nb\n"), ("crlf.txt", b"a\r\nb\r\n"), ("img.bin", b"\0\r\n")):
            with open(os.path.join(self.repo, name), "wb") as fh:
                fh.write(data)
        git(self.repo, "add", "-A")
        git(self.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base")

    def tearDown(self):
        shutil.rmtree(self.repo, ignore_errors=True)

    def write(self, name, data):
        with open(os.path.join(self.repo, name), "wb") as fh:
            fh.write(data)

    def read(self, name):
        with open(os.path.join(self.repo, name), "rb") as fh:
            return fh.read()

    def test_only_lf_files_saved_with_crlf_go_back_to_lf(self):
        self.write("lf.js", b"a\r\nb\r\nc\r\n")
        self.write("crlf.txt", b"a\r\nb\r\nc\r\n")
        self.write("img.bin", b"\0\r\n\r\n")
        self.write("new.js", b"x\r\n")
        self.assertEqual(keep_eol(self.repo), ["lf.js"])
        self.assertEqual(self.read("lf.js"), b"a\nb\nc\n")
        self.assertEqual(self.read("crlf.txt"), b"a\r\nb\r\nc\r\n")      # was CRLF already: kept
        self.assertEqual(self.read("img.bin"), b"\0\r\n\r\n")             # binary: untouched
        self.assertEqual(self.read("new.js"), b"x\r\n")                   # new file: the agent's choice


if __name__ == "__main__":
    unittest.main()
