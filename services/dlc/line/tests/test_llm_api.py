"""S3: Messages API backend with a mocked opener (no network)."""

import io
import json
import os
import unittest
from unittest import mock

from line import codes
from line.codes import LineError
from line.config import load_config
from line.llm import make_llm
from line.llm.api import ApiBackend


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def cfg():
    return load_config(env={}, line_json=None, rag_local_json=None, llm="api")


class ApiTest(unittest.TestCase):
    def test_refuses_agentic_without_network(self):
        opener = mock.Mock()
        llm = make_llm(cfg(), backend=ApiBackend(cfg(), opener=opener))
        with self.assertRaises(LineError) as cm:
            llm.agentic("builder", ".", "build", 10, 1.0, key="U1#1", run="r1")
        self.assertEqual(cm.exception.code, codes.LLM_ERROR)
        self.assertIn("LINE_LLM=cli", cm.exception.message)
        opener.assert_not_called()
        self.assertEqual(llm.ledger, [])

    def test_complete_posts_and_prices(self):
        seen = []

        def opener(req, timeout=None):
            seen.append(req)
            return Resp(json.dumps({"model": "claude-opus-5-5", "content": [{"type": "text", "text": '{"a": 1}'}],
                                    "usage": {"input_tokens": 1000, "output_tokens": 100}}).encode())

        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-test"}):
            llm = make_llm(cfg(), backend=ApiBackend(cfg(), opener=opener))
            res = llm.complete("reader", "read", {"type": "object", "required": ["a"]}, key="A", run="r1")
        req = seen[0]
        self.assertEqual(req.full_url, "https://api.anthropic.com/v1/messages")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.get_header("X-api-key"), "sk-test")
        body = json.loads(req.data)
        self.assertEqual(body["model"], "claude-opus-5-5")
        self.assertEqual(res.data, {"a": 1})
        self.assertAlmostEqual(res.usd, (1000 * 4.0 + 100 * 20.0) / 1e6)
        self.assertNotIn("sk-test", json.dumps(llm.ledger))

    def test_missing_key(self):
        opener = mock.Mock()
        env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(LineError) as cm:
                make_llm(cfg(), backend=ApiBackend(cfg(), opener=opener)).complete("reader", "r", key="A")
        self.assertEqual(cm.exception.code, codes.LLM_ERROR)
        opener.assert_not_called()

    def test_factory_selects_backends(self):
        for mode, cls in (("fake", "FakeBackend"), ("cli", "CliBackend"), ("api", "ApiBackend")):
            c = load_config(env={}, line_json=None, rag_local_json=None, llm=mode)
            self.assertEqual(type(make_llm(c).backend).__name__, cls)


if __name__ == "__main__":
    unittest.main()
