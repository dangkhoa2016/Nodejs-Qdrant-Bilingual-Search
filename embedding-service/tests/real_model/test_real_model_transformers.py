import math
import os

import pytest
import torch

from engine import EmbeddingConfig, EmbeddingEngine
from model_loader import (
    assert_loaded_model_dtype,
    assert_model_on_cpu,
    build_transformers_model_kwargs,
    build_transformers_tokenizer_kwargs,
)
from profiles import DEFAULT_QWEN3_QUERY_INSTRUCTION, resolve_embedding_profile
from runtime_config import resolve_runtime_config
from transformers_engine import TransformersEmbeddingModel

pytestmark = pytest.mark.real_model

MODEL_NAME = "Qwen/Qwen3-Embedding-4B"
DIMENSION = 2560
PROFILE_NAME = "qwen3"
DEVICE = "cpu"
DTYPE = "float16"


def _model_target() -> str:
    explicit = os.getenv("EMBEDDING_MODEL_PATH")
    if explicit:
        return explicit
    rooted = os.getenv("KAGGLE_INPUT_ROOT", "/kaggle/input")
    candidate = os.path.join(
        rooted,
        "models",
        "dangkhoa2016",
        "qwen-qwen3-embedding-4b",
        "transformers",
        "default",
        "1",
    )
    if os.path.isdir(candidate):
        return candidate
    raise RuntimeError(
        "EMBEDDING_MODEL_PATH is required when the default Kaggle input is not present"
    )


@pytest.fixture(scope="module")
def adapter():
    if os.getenv("RUN_REAL_MODEL_TESTS") != "1":
        pytest.skip("set RUN_REAL_MODEL_TESTS=1 to load the real model")

    from transformers import AutoModel, AutoTokenizer

    runtime = resolve_runtime_config(
        device=DEVICE,
        dtype=DTYPE,
        cuda_available=torch.cuda.is_available(),
    )
    model_kwargs = build_transformers_model_kwargs(runtime, torch_module=torch)
    tokenizer_kwargs = build_transformers_tokenizer_kwargs(profile_name=PROFILE_NAME)

    target = _model_target()
    tokenizer = AutoTokenizer.from_pretrained(target, **tokenizer_kwargs)
    raw_model = AutoModel.from_pretrained(target, **model_kwargs)
    assert_model_on_cpu(raw_model)
    assert_loaded_model_dtype(raw_model, DTYPE, torch_module=torch)
    adapter = TransformersEmbeddingModel(
        raw_model,
        tokenizer,
        max_seq_length=512,
        batch_size=1,
        device=runtime.device,
    )
    yield adapter


@pytest.fixture(scope="module")
def engine(adapter):
    profile = resolve_embedding_profile(
        MODEL_NAME,
        profile_name=PROFILE_NAME,
        dimension=DIMENSION,
    )
    config = EmbeddingConfig(
        model_name=MODEL_NAME,
        dimension=profile.dimension,
        profile=profile.name,
        query_strategy=profile.query_strategy,
        document_strategy=profile.document_strategy,
        query_prefix=profile.query_prefix,
        document_prefix=profile.document_prefix,
        query_prompt=profile.query_prompt,
        query_instruction_id=profile.query_instruction_id,
        batch_size=1,
    )
    return EmbeddingEngine(adapter, config)


def test_real_model_is_cpu_only_float16_and_cache_disabled(adapter):
    assert adapter.device == "cpu"
    assert adapter.config.num_hidden_layers == 36
    assert adapter.config.hidden_size == 2560
    assert adapter.config.use_cache is False
    for p in adapter.model.parameters():
        assert str(p.dtype) == "torch.float16"


def test_real_model_canonical_query_prompt_is_exact(engine, adapter):
    strategies = engine.config
    assert strategies.query_strategy == "prompt"
    assert strategies.document_strategy == "raw"
    assert strategies.query_instruction_id == "geo-retrieval-v1:d014d3ec6df87e49"
    assert strategies.query_prompt == DEFAULT_QWEN3_QUERY_INSTRUCTION


def test_real_model_english_query_is_finite_normalized_2560(engine):
    vector = engine.embed_query("Southeast Asian country using baht")
    assert len(vector) == 2560
    assert all(math.isfinite(x) for x in vector)
    norm = math.sqrt(sum(x * x for x in vector))
    assert norm == pytest.approx(1.0, abs=1e-4)


def test_real_model_vietnamese_query_is_finite(engine):
    vector = engine.embed_query("quốc gia Đông Nam Á sử dụng đồng baht")
    assert len(vector) == 2560
    assert all(math.isfinite(x) for x in vector)
