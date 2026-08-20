from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from functools import lru_cache
from threading import Lock
from time import perf_counter

import torch
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

from binary_transport import encode_float32_matrix
from engine import EmbeddingConfig, EmbeddingEngine
from model_loader import (
    assert_loaded_model_dtype,
    assert_model_on_cpu,
    build_transformers_model_kwargs,
    build_transformers_tokenizer_kwargs,
    disable_model_cache,
    resolve_model_load_target,
)
from profiles import EmbeddingProfile, resolve_embedding_profile
from provenance import embedding_runtime_identity
from runtime_config import RuntimeConfig, resolve_runtime_config
from request_stats import EmbeddingRequestStats
from translation_engine import MarianBackend, TranslationConfig, TranslationEngine
from transformers_engine import TransformersEmbeddingModel

MODEL_NAME = os.getenv("EMBEDDING_MODEL", "intfloat/multilingual-e5-small")
MODEL_LOAD_TARGET = resolve_model_load_target(
    MODEL_NAME,
    os.getenv("EMBEDDING_MODEL_PATH"),
)
PROFILE_NAME = os.getenv("EMBEDDING_PROFILE", "auto")
DIMENSION_OVERRIDE = int(os.environ["EMBEDDING_DIMENSION"]) if os.getenv("EMBEDDING_DIMENSION") else None
QUERY_INSTRUCTION = os.getenv("EMBEDDING_QUERY_INSTRUCTION")
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))
MAX_SEQ_LENGTH = int(os.getenv("EMBEDDING_MAX_SEQ_LENGTH", "512"))
EMBEDDING_DEVICE = os.getenv("EMBEDDING_DEVICE", "auto")
EMBEDDING_DTYPE = os.getenv("EMBEDDING_DTYPE", "auto")
TRANSLATION_MODEL = os.getenv("TRANSLATION_MODEL", "Helsinki-NLP/opus-mt-en-vi")
ENABLE_TRANSLATION = os.getenv("ENABLE_TRANSLATION", "false").lower() in {"1", "true", "yes"}

if EMBEDDING_BATCH_SIZE < 1:
    raise ValueError("EMBEDDING_BATCH_SIZE must be a positive integer")
if MAX_SEQ_LENGTH < 1:
    raise ValueError("EMBEDDING_MAX_SEQ_LENGTH must be a positive integer")

PROFILE: EmbeddingProfile = resolve_embedding_profile(
    MODEL_NAME,
    profile_name=PROFILE_NAME,
    dimension=DIMENSION_OVERRIDE,
    query_instruction=QUERY_INSTRUCTION,
)
DIMENSION = PROFILE.dimension
RUNTIME: RuntimeConfig = resolve_runtime_config(
    device=EMBEDDING_DEVICE,
    dtype=EMBEDDING_DTYPE,
    cuda_available=torch.cuda.is_available(),
)

# Bump when reuse-safety assumptions change (especially loaded-dtype verification).
EMBEDDING_RUNTIME_CONTRACT = "embedding-runtime-dtype-verified-v1"

logger = logging.getLogger("uvicorn.error")
REQUEST_STATS = EmbeddingRequestStats()

WARMUP_STATE: dict[str, object] = {
    "completed": False,
    "inference_ms": None,
}
ENGINE_INIT_STATE: dict[str, object] = {
    "completed": False,
    "construction_count": 0,
    "warmup_count": 0,
}
WARMUP_TEXT = "Southeast Asian country whose capital is Bangkok"

_ENGINE: EmbeddingEngine | None = None
_ENGINE_INIT_LOCK = Lock()


class QueryRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class DocumentsRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=256)


class TranslationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    from_: str = Field(default="en", alias="from")
    to: str = "vi"


def _runtime_identity() -> dict[str, object]:
    # Preserve the exact legacy E5 provenance contract so the already-verified
    # knowledge_entities_e5_real_v1 baseline remains auditable without reseeding.
    if PROFILE.name == "e5":
        return embedding_runtime_identity()
    return embedding_runtime_identity(
        accelerator=RUNTIME.accelerator,
        device=RUNTIME.device,
        dtype=RUNTIME.dtype,
        runtime=RUNTIME.runtime,
        profile=PROFILE.name,
        query_strategy=PROFILE.query_strategy,
        query_instruction_id=PROFILE.query_instruction_id,
        document_strategy=PROFILE.document_strategy,
    )


def _model_info() -> dict[str, object]:
    return {
        "model": MODEL_NAME,
        "dimension": DIMENSION,
        "query_prefix": f"{PROFILE.query_prefix}:" if PROFILE.query_prefix else None,
        "document_prefix": f"{PROFILE.document_prefix}:" if PROFILE.document_prefix else None,
        "query_prompt": PROFILE.query_prompt,
        "max_seq_length": MAX_SEQ_LENGTH,
        "batch_size": EMBEDDING_BATCH_SIZE,
        "transports": {"json": True, "float32_binary": True},
        "runtime_contract": EMBEDDING_RUNTIME_CONTRACT,
        "warmup": dict(WARMUP_STATE),
        "initialization": dict(ENGINE_INIT_STATE),
        **_runtime_identity(),
    }


def _build_embedding_model():
    model_kwargs = build_transformers_model_kwargs(
        RUNTIME,
        torch_module=torch,
    )
    tokenizer_kwargs = build_transformers_tokenizer_kwargs(profile_name=PROFILE.name)
    return SentenceTransformer(
        MODEL_LOAD_TARGET,
        model_kwargs=model_kwargs,
        tokenizer_kwargs=tokenizer_kwargs,
    )


def _build_and_warm_engine() -> EmbeddingEngine:
    model = _build_embedding_model()
    ENGINE_INIT_STATE["construction_count"] = int(ENGINE_INIT_STATE["construction_count"]) + 1

    if PROFILE.name == "qwen3":
        assert_loaded_model_dtype(model, RUNTIME.dtype, torch_module=torch)
        assert_model_on_cpu(model)

    model.max_seq_length = MAX_SEQ_LENGTH

    engine = EmbeddingEngine(
        model,
        EmbeddingConfig(
            model_name=MODEL_NAME,
            dimension=DIMENSION,
            profile=PROFILE.name,
            query_strategy=PROFILE.query_strategy,
            document_strategy=PROFILE.document_strategy,
            query_prefix=PROFILE.query_prefix,
            document_prefix=PROFILE.document_prefix,
            query_prompt=PROFILE.query_prompt,
            query_instruction_id=PROFILE.query_instruction_id,
            batch_size=EMBEDDING_BATCH_SIZE,
        ),
    )

    started = perf_counter()
    engine.embed_query(WARMUP_TEXT)
    elapsed_ms = round((perf_counter() - started) * 1000, 3)

    ENGINE_INIT_STATE["warmup_count"] = int(ENGINE_INIT_STATE["warmup_count"]) + 1
    WARMUP_STATE["inference_ms"] = elapsed_ms
    WARMUP_STATE["completed"] = True
    ENGINE_INIT_STATE["completed"] = True

    logger.info(
        "embedding_warmup_completed inference_ms=%.3f construction_count=%d warmup_count=%d",
        elapsed_ms,
        ENGINE_INIT_STATE["construction_count"],
        ENGINE_INIT_STATE["warmup_count"],
    )
    return engine


def _build_transformers_model(model_target: str, **kwargs) -> TransformersEmbeddingModel:
    """Build a native Transformers AutoModel/AutoTokenizer adapter on CPU.

    This is the production model factory for the qwen3 transformers profile.
    """
    from transformers import AutoModel, AutoTokenizer

    model_kwargs = dict(kwargs.pop("model_kwargs", {}) or {})
    tokenizer_kwargs = dict(kwargs.pop("tokenizer_kwargs", {}) or {})
    tokenizer_kwargs.setdefault("padding_side", "left")

    tokenizer = AutoTokenizer.from_pretrained(model_target, **tokenizer_kwargs)
    raw_model = AutoModel.from_pretrained(model_target, **model_kwargs)
    assert_model_on_cpu(raw_model)
    disable_model_cache(raw_model)
    raw_model.eval()
    return TransformersEmbeddingModel(
        raw_model,
        tokenizer,
        max_seq_length=MAX_SEQ_LENGTH,
        batch_size=EMBEDDING_BATCH_SIZE,
        device=RUNTIME.device,
    )


# Model-factory seam kept module-local so tests can inject fake encoders while
# preserving the exact runtime loading behavior as a private default.
SentenceTransformer = _build_transformers_model


def get_engine() -> EmbeddingEngine:
    global _ENGINE
    if _ENGINE is not None:
        return _ENGINE

    with _ENGINE_INIT_LOCK:
        if _ENGINE is not None:
            return _ENGINE
        _ENGINE = _build_and_warm_engine()
        return _ENGINE


def _reset_engine_state_for_tests() -> None:
    global _ENGINE
    with _ENGINE_INIT_LOCK:
        _ENGINE = None
        ENGINE_INIT_STATE.update({
            "completed": False,
            "construction_count": 0,
            "warmup_count": 0,
        })
        WARMUP_STATE.update({
            "completed": False,
            "inference_ms": None,
        })


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_engine()
    yield

app = FastAPI(title="Bilingual Search Embedding Service", version="0.4.0", lifespan=lifespan)


@lru_cache(maxsize=1)
def get_translation_engine() -> TranslationEngine:
    if not ENABLE_TRANSLATION:
        raise RuntimeError("translation is disabled; set ENABLE_TRANSLATION=true")
    backend = MarianBackend(TRANSLATION_MODEL)
    return TranslationEngine(backend, TranslationConfig(model_name=TRANSLATION_MODEL))


@app.get("/health")
def health():
    try:
        get_engine()
        return {"status": "ok", "ready": True, **_model_info()}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"model unavailable: {type(exc).__name__}") from exc


@app.get("/model")
def model_info():
    get_engine()
    return _model_info()


@app.get("/stats")
def runtime_stats():
    get_engine()
    return {**_model_info(), "requests": REQUEST_STATS.snapshot()}


@app.post("/embed/query")
def embed_query(request: QueryRequest):
    started = perf_counter()
    vector = get_engine().embed_query(request.text)
    inference_ms = round((perf_counter() - started) * 1000, 3)
    stats = REQUEST_STATS.record_query(inference_ms=inference_ms)
    logger.info(
        "embedding_query_completed queries=%d inference_ms=%.3f",
        stats["queries_embedded"],
        inference_ms,
    )
    return {
        "model": MODEL_NAME,
        "dimension": DIMENSION,
        "vector": vector,
        "inference_ms": inference_ms,
        "queries_embedded_total": stats["queries_embedded"],
    }


@app.post("/embed/documents")
def embed_documents(request: DocumentsRequest):
    started = perf_counter()
    vectors = get_engine().embed_documents(request.texts)
    inference_ms = round((perf_counter() - started) * 1000, 3)
    stats = REQUEST_STATS.record_documents(count=len(request.texts), inference_ms=inference_ms)
    logger.info(
        "embedding_documents_completed batch=%d requests=%d documents=%d inference_ms=%.3f",
        len(request.texts),
        stats["document_requests"],
        stats["documents_embedded"],
        inference_ms,
    )
    return {
        "model": MODEL_NAME,
        "dimension": DIMENSION,
        "vectors": vectors,
        "inference_ms": inference_ms,
        "document_requests_total": stats["document_requests"],
        "documents_embedded_total": stats["documents_embedded"],
    }


@app.post("/embed/documents/binary")
def embed_documents_binary(request: DocumentsRequest):
    started = perf_counter()
    vectors = get_engine().embed_documents(request.texts)
    inference_ms = round((perf_counter() - started) * 1000, 3)
    stats = REQUEST_STATS.record_documents(count=len(request.texts), inference_ms=inference_ms)
    logger.info(
        "embedding_documents_binary_completed batch=%d requests=%d documents=%d inference_ms=%.3f",
        len(request.texts),
        stats["document_requests"],
        stats["documents_embedded"],
        inference_ms,
    )
    body = encode_float32_matrix(vectors, dimension=DIMENSION)
    return Response(
        content=body,
        media_type="application/x-float32",
        headers={
            "X-Embedding-Count": str(len(request.texts)),
            "X-Embedding-Dimension": str(DIMENSION),
            "X-Embedding-Dtype": "float32",
            "X-Embedding-Inference-Ms": str(inference_ms),
            "X-Embedding-Document-Requests-Total": str(stats["document_requests"]),
            "X-Embedding-Documents-Total": str(stats["documents_embedded"]),
        },
    )


@app.post("/translate")
def translate(request: TranslationRequest):
    if not ENABLE_TRANSLATION:
        raise HTTPException(status_code=503, detail="translation is disabled")
    try:
        text = get_translation_engine().translate(request.text, request.from_, request.to)
        return {"model": TRANSLATION_MODEL, "from": request.from_, "to": request.to, "translation": text}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
