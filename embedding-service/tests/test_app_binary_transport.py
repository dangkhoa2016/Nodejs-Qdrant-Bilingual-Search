import struct
import sys
import types

fake_sentence_transformers = types.ModuleType("sentence_transformers")
fake_sentence_transformers.SentenceTransformer = object
sys.modules.setdefault("sentence_transformers", fake_sentence_transformers)

from fastapi.testclient import TestClient
import app as app_module


class FakeEngine:
    def embed_documents(self, texts):
        return [[1.5, -2.25], [3.0, 4.5]][: len(texts)]


def test_model_advertises_json_and_float32_binary_transports(monkeypatch):
    monkeypatch.setattr(app_module, "DIMENSION", 2)
    monkeypatch.setattr(app_module, "get_engine", lambda: FakeEngine())
    response = TestClient(app_module.app).get("/model")
    assert response.status_code == 200
    assert response.json()["model"] == app_module.MODEL_NAME
    assert response.json()["transports"] == {"json": True, "float32_binary": True}


def test_model_remains_canonical_model_identity_verifying_engine_first(monkeypatch):
    monkeypatch.setattr(app_module, "get_engine", lambda: FakeEngine())
    response = TestClient(app_module.app).get("/model")
    assert response.status_code == 200
    body = response.json()
    assert body["model"] == app_module.MODEL_NAME
    assert body["model"] != app_module.MODEL_LOAD_TARGET or app_module.MODEL_LOAD_TARGET == app_module.MODEL_NAME


def test_model_cannot_report_success_when_engine_verification_raises_dtype_mismatch(monkeypatch):
    def failing_engine():
        raise RuntimeError("loaded model dtype mismatch: requested=float32 actual=bfloat16")
    monkeypatch.setattr(app_module, "get_engine", failing_engine)
    response = TestClient(app_module.app, raise_server_exceptions=False).get("/model")
    assert response.status_code >= 500
    assert response.status_code != 200


def test_health_returns_503_when_engine_verification_raises_runtime_mismatch(monkeypatch):
    def failing_engine():
        raise RuntimeError("loaded model dtype mismatch: requested=float32 actual=bfloat16")
    monkeypatch.setattr(app_module, "get_engine", failing_engine)
    response = TestClient(app_module.app).get("/health")
    assert response.status_code == 503


def test_binary_documents_endpoint_returns_little_endian_row_major_float32(monkeypatch):
    monkeypatch.setattr(app_module, "DIMENSION", 2)
    monkeypatch.setattr(app_module, "get_engine", lambda: FakeEngine())
    response = TestClient(app_module.app).post("/embed/documents/binary", json={"texts": ["a", "b"]})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-float32")
    assert response.headers["x-embedding-count"] == "2"
    assert response.headers["x-embedding-dimension"] == "2"
    assert response.headers["x-embedding-dtype"] == "float32"
    assert float(response.headers["x-embedding-inference-ms"]) >= 0
    assert struct.unpack("<4f", response.content) == (1.5, -2.25, 3.0, 4.5)


def test_model_exposes_dtype_verified_runtime_contract_marker(monkeypatch):
    monkeypatch.setattr(app_module, "get_engine", lambda: FakeEngine())
    response = TestClient(app_module.app).get("/model")
    assert response.status_code == 200
    assert response.json()["runtime_contract"] == "embedding-runtime-dtype-verified-v1"
