import sys
import threading
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor

fake_sentence_transformers = types.ModuleType("sentence_transformers")
fake_sentence_transformers.SentenceTransformer = object
sys.modules.setdefault("sentence_transformers", fake_sentence_transformers)

from fastapi.testclient import TestClient
import app as app_module


class RecordingModel:
    def __init__(self, *args, **kwargs):
        self.max_seq_length = app_module.MAX_SEQ_LENGTH
        self.encoded = []

    def encode(self, sentences, **kwargs):
        self.encoded.extend(sentences)
        dimension = app_module.DIMENSION
        return [[0.125] * dimension for _ in sentences]


def _fake_model_factory(*args, **kwargs):
    return RecordingModel()


class RecordingEngine:
    def __init__(self, model, config):
        self.model = model
        self.config = config
        self.embed_query_calls = 0

    def embed_query(self, text):
        self.embed_query_calls += 1
        return self.model.encode([text])[0]

    def embed_documents(self, texts):
        return self.model.encode(texts)


class FailingEngine:
    def __init__(self, model, config):
        self.model = model
        self.config = config

    def embed_query(self, text):
        raise RuntimeError("warmup failed")


class AppWarmupTest(unittest.TestCase):
    def setUp(self):
        self._orig_st = app_module.SentenceTransformer
        self._orig_engine = app_module.EmbeddingEngine
        self._install_engine(RecordingEngine)
        self._reset_state()

    def tearDown(self):
        app_module.SentenceTransformer = self._orig_st
        app_module.EmbeddingEngine = self._orig_engine
        app_module._reset_engine_state_for_tests()

    def _install_engine(self, engine_cls):
        app_module.SentenceTransformer = _fake_model_factory
        app_module.EmbeddingEngine = engine_cls

    def _reset_state(self):
        app_module._reset_engine_state_for_tests()

    def test_get_engine_warms_up_embed_query_exactly_once(self):
        first = app_module.get_engine()
        second = app_module.get_engine()
        self.assertIs(first, second)
        self.assertIsInstance(first, RecordingEngine)
        self.assertEqual(first.embed_query_calls, 1)
        self.assertIs(app_module.WARMUP_STATE["completed"], True)
        self.assertIsInstance(app_module.WARMUP_STATE["inference_ms"], (int, float))
        self.assertGreaterEqual(app_module.WARMUP_STATE["inference_ms"], 0)

    def test_model_info_exposes_warmup_completed_and_latency(self):
        app_module.get_engine()
        info = app_module._model_info()
        self.assertEqual(
            info["warmup"],
            {
                "completed": True,
                "inference_ms": app_module.WARMUP_STATE["inference_ms"],
            },
        )

    def test_warmup_failure_propagates_and_health_returns_503(self):
        self._install_engine(FailingEngine)
        self._reset_state()
        client = TestClient(app_module.app, raise_server_exceptions=False)
        response = client.get("/health")
        self.assertEqual(response.status_code, 503)

    def test_warmup_does_not_increment_public_request_counters(self):
        before = app_module.REQUEST_STATS.snapshot()
        app_module.get_engine()
        app_module.get_engine()
        after = app_module.REQUEST_STATS.snapshot()
        self.assertEqual(after["query_requests"], before["query_requests"])
        self.assertEqual(after["queries_embedded"], before["queries_embedded"])


class SlowRecordingEngine:
    """Engine whose embed_query sleeps to ensure concurrent overlap."""

    _init_started = threading.Event()
    _init_wait = threading.Event()

    def __init__(self, model, config):
        self.model = model
        self.config = config
        self.embed_query_calls = 0

    def embed_query(self, text):
        self.embed_query_calls += 1
        return self.model.encode([text])[0]


class SlowModel:
    def __init__(self, *args, **kwargs):
        self.max_seq_length = app_module.MAX_SEQ_LENGTH
        self.encoded = []

    def encode(self, sentences, **kwargs):
        self.encoded.extend(sentences)
        dimension = app_module.DIMENSION
        return [[0.125] * dimension for _ in sentences]


class SlowInitModel:
    """Model that blocks during construction so concurrent threads overlap."""

    def __init__(self, *args, **kwargs):
        self.max_seq_length = app_module.MAX_SEQ_LENGTH
        self.encoded = []
        SlowRecordingEngine._init_started.set()
        SlowRecordingEngine._init_wait.wait(timeout=1)

    def encode(self, sentences, **kwargs):
        self.encoded.extend(sentences)
        dimension = app_module.DIMENSION
        return [[0.125] * dimension for _ in sentences]


def _slow_model_factory(*args, **kwargs):
    return SlowInitModel()


class ConcurrencySingleFlightTest(unittest.TestCase):
    """Tests that get_engine() is single-flight under concurrent callers."""

    def setUp(self):
        self._orig_st = app_module.SentenceTransformer
        self._orig_engine = app_module.EmbeddingEngine
        SlowRecordingEngine._init_started.clear()
        SlowRecordingEngine._init_wait.clear()
        app_module._reset_engine_state_for_tests()
        app_module.SentenceTransformer = _slow_model_factory
        app_module.EmbeddingEngine = SlowRecordingEngine

    def tearDown(self):
        SlowRecordingEngine._init_wait.set()
        app_module.SentenceTransformer = self._orig_st
        app_module.EmbeddingEngine = self._orig_engine
        app_module._reset_engine_state_for_tests()

    def test_get_engine_is_single_flight_under_concurrency(self):
        SlowRecordingEngine._init_started.wait(timeout=2)
        with ThreadPoolExecutor(max_workers=16) as pool:
            engines = list(pool.map(lambda _: app_module.get_engine(), range(32)))

        self.assertTrue(all(engine is engines[0] for engine in engines))
        self.assertEqual(app_module.ENGINE_INIT_STATE["construction_count"], 1)
        self.assertEqual(app_module.ENGINE_INIT_STATE["warmup_count"], 1)
        self.assertTrue(app_module.WARMUP_STATE["completed"])

    def test_warmup_failure_does_not_poison_singleton(self):
        """If first init fails, _ENGINE remains None and retry can succeed."""

        class FailingSlowInitModel:
            _fail = True

            def __init__(self, *args, **kwargs):
                self.max_seq_length = app_module.MAX_SEQ_LENGTH
                if FailingSlowInitModel._fail:
                    raise RuntimeError("simulated warmup failure")

            def encode(self, sentences, **kwargs):
                return [[0.125] * app_module.DIMENSION for _ in sentences]

        def failing_factory(*args, **kwargs):
            return FailingSlowInitModel()

        app_module.SentenceTransformer = failing_factory
        with self.assertRaises(RuntimeError):
            app_module.get_engine()
        self.assertIsNone(app_module._ENGINE)
        self.assertFalse(app_module.WARMUP_STATE["completed"])
        self.assertFalse(app_module.ENGINE_INIT_STATE["completed"])

        FailingSlowInitModel._fail = False
        app_module.SentenceTransformer = _slow_model_factory
        engine = app_module.get_engine()
        self.assertIsNotNone(engine)
        self.assertTrue(app_module.WARMUP_STATE["completed"])
        self.assertTrue(app_module.ENGINE_INIT_STATE["completed"])


class LifespanFailClosedTest(unittest.TestCase):
    """Tests that a warmup failure during lifespan prevents app readiness."""

    def setUp(self):
        self._orig_st = app_module.SentenceTransformer
        self._orig_engine = app_module.EmbeddingEngine
        app_module._reset_engine_state_for_tests()

    def tearDown(self):
        app_module.SentenceTransformer = self._orig_st
        app_module.EmbeddingEngine = self._orig_engine
        app_module._reset_engine_state_for_tests()

    def test_lifespan_failure_prevents_ready(self):
        app_module.SentenceTransformer = _slow_model_factory
        app_module.EmbeddingEngine = FailingEngine

        with self.assertRaises(RuntimeError):
            TestClient(app_module.app, raise_server_exceptions=True).__enter__()

    def test_lifespan_success_allows_ready(self):
        app_module.SentenceTransformer = _fake_model_factory
        app_module.EmbeddingEngine = RecordingEngine
        with TestClient(app_module.app, raise_server_exceptions=True) as client:
            resp = client.get("/health")
            self.assertEqual(resp.status_code, 200)
            self.assertTrue(resp.json()["ready"])


class RequestStatsZeroAfterWarmupTest(unittest.TestCase):
    """Warm-up must not increment public REQUEST_STATS query counters."""

    def setUp(self):
        self._orig_st = app_module.SentenceTransformer
        self._orig_engine = app_module.EmbeddingEngine
        app_module._reset_engine_state_for_tests()
        app_module.SentenceTransformer = _fake_model_factory
        app_module.EmbeddingEngine = RecordingEngine

    def tearDown(self):
        app_module.SentenceTransformer = self._orig_st
        app_module.EmbeddingEngine = self._orig_engine
        app_module._reset_engine_state_for_tests()

    def test_warmup_does_not_touch_public_counters(self):
        app_module.get_engine()
        snapshot = app_module.REQUEST_STATS.snapshot()
        self.assertEqual(snapshot["query_requests"], 0)
        self.assertEqual(snapshot["queries_embedded"], 0)


if __name__ == "__main__":
    unittest.main()
