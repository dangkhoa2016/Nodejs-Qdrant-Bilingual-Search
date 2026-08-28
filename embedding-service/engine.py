from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence


class EncoderModel(Protocol):
    def encode(self, sentences: Sequence[str], **kwargs): ...


@dataclass(frozen=True)
class EmbeddingConfig:
    model_name: str = "intfloat/multilingual-e5-small"
    dimension: int = 384
    profile: str = "e5"
    query_strategy: str = "prefix"
    document_strategy: str = "prefix"
    query_prefix: str | None = "query"
    document_prefix: str | None = "passage"
    query_prompt: str | None = None
    query_instruction_id: str | None = None
    batch_size: int = 32


class EmbeddingEngine:
    """Model-profile-aware SentenceTransformers adapter."""

    def __init__(self, model: EncoderModel, config: EmbeddingConfig):
        self.model = model
        self.config = config

    def _encode(self, texts: Sequence[str], *, kind: str) -> list[list[float]]:
        if not texts or any(not isinstance(text, str) or not text.strip() for text in texts):
            raise ValueError("texts must contain non-empty strings")

        cleaned = [text.strip() for text in texts]
        kwargs = {
            "normalize_embeddings": True,
            "convert_to_numpy": True,
            "show_progress_bar": False,
            "batch_size": self.config.batch_size,
        }

        if kind == "query":
            if self.config.query_strategy == "prefix":
                if not self.config.query_prefix:
                    raise ValueError("query prefix is required for prefix strategy")
                prepared = [f"{self.config.query_prefix}: {text}" for text in cleaned]
            elif self.config.query_strategy == "prompt":
                if not self.config.query_prompt:
                    raise ValueError("query prompt is required for prompt strategy")
                prepared = cleaned
                kwargs["prompt"] = self.config.query_prompt
            else:
                raise ValueError(f"unsupported query strategy: {self.config.query_strategy}")
        elif kind == "document":
            if self.config.document_strategy == "prefix":
                if not self.config.document_prefix:
                    raise ValueError("document prefix is required for prefix strategy")
                prepared = [f"{self.config.document_prefix}: {text}" for text in cleaned]
            elif self.config.document_strategy == "raw":
                prepared = cleaned
            else:
                raise ValueError(f"unsupported document strategy: {self.config.document_strategy}")
        else:
            raise ValueError(f"unsupported embedding kind: {kind}")

        encoded = self.model.encode(prepared, **kwargs)
        vectors = [[float(value) for value in row] for row in encoded]
        if any(len(vector) != self.config.dimension for vector in vectors):
            raise ValueError(f"expected vectors with dimension {self.config.dimension}")
        return vectors

    def embed_query(self, text: str) -> list[float]:
        return self._encode([text], kind="query")[0]

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return self._encode(texts, kind="document")
