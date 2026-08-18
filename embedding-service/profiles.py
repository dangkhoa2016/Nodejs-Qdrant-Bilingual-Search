from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256


DEFAULT_QWEN3_QUERY_INSTRUCTION = (
    "Instruct: Retrieve the geographic entity that best answers the query\nQuery:"
)


@dataclass(frozen=True)
class EmbeddingProfile:
    name: str
    dimension: int
    query_strategy: str
    document_strategy: str
    query_prefix: str | None = None
    document_prefix: str | None = None
    query_prompt: str | None = None
    query_instruction_id: str | None = None


def _instruction_id(prompt: str) -> str:
    digest = sha256(prompt.encode("utf-8")).hexdigest()[:16]
    return f"geo-retrieval-v1:{digest}"


def resolve_embedding_profile(
    model_name: str,
    *,
    profile_name: str = "auto",
    dimension: int | None = None,
    query_instruction: str | None = None,
) -> EmbeddingProfile:
    model = str(model_name or "").strip()
    if not model:
        raise ValueError("EMBEDDING_MODEL must be non-empty")

    requested = str(profile_name or "auto").strip().lower()
    if requested == "auto":
        if model == "intfloat/multilingual-e5-small":
            requested = "e5"
        elif model.startswith("Qwen/Qwen3-Embedding-"):
            requested = "qwen3"
        else:
            raise ValueError(
                f"No automatic embedding profile for {model}; set EMBEDDING_PROFILE explicitly"
            )

    if requested == "e5":
        resolved_dimension = dimension or (
            384 if model == "intfloat/multilingual-e5-small" else None
        )
        if not resolved_dimension:
            raise ValueError("EMBEDDING_DIMENSION is required for this E5 model")
        return EmbeddingProfile(
            name="e5",
            dimension=resolved_dimension,
            query_strategy="prefix",
            document_strategy="prefix",
            query_prefix="query",
            document_prefix="passage",
        )

    if requested == "qwen3":
        known_dimensions = {
            "Qwen/Qwen3-Embedding-0.6B": 1024,
            "Qwen/Qwen3-Embedding-4B": 2560,
            "Qwen/Qwen3-Embedding-8B": 4096,
        }
        full_dimension = known_dimensions.get(model)
        if dimension is not None and full_dimension is not None and dimension != full_dimension:
            raise ValueError(
                f"{model} currently requires its full embedding dimension {full_dimension}; "
                "custom MRL dimensions are not enabled in this service yet"
            )
        resolved_dimension = dimension or full_dimension
        if not resolved_dimension:
            raise ValueError("EMBEDDING_DIMENSION is required for this Qwen3 embedding model")
        prompt = (query_instruction or DEFAULT_QWEN3_QUERY_INSTRUCTION).strip()
        if not prompt:
            raise ValueError("EMBEDDING_QUERY_INSTRUCTION must be non-empty for qwen3 profile")
        return EmbeddingProfile(
            name="qwen3",
            dimension=resolved_dimension,
            query_strategy="prompt",
            document_strategy="raw",
            query_prompt=prompt,
            query_instruction_id=_instruction_id(prompt),
        )

    raise ValueError("EMBEDDING_PROFILE must be one of auto, e5 or qwen3")
