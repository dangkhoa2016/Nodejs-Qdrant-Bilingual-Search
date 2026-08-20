from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import torch

from model_loader import assert_model_on_cpu, disable_model_cache
from pooling import last_token_pool, normalize_embeddings as _normalize_embeddings


class TransformersEmbeddingModel:
    """SentenceTransformer-compatible adapter over a native Transformers model.

    Wraps an AutoTokenizer + AutoModel so the repository's EmbeddingEngine can
    keep its profile-aware prefix/prompt strategy while the actual numerical
    path is the proven native Transformers FP16 CPU runtime:
        tokenize -> forward (FP16, use_cache off) -> last-token pooling
        -> cast to Float32 -> L2 normalize in Float32 -> Float32[dim].
    """

    def __init__(
        self,
        model,
        tokenizer,
        *,
        max_seq_length: int = 512,
        batch_size: int = 1,
        device: str = "cpu",
    ) -> None:
        self.model = model
        self.tokenizer = tokenizer
        self.max_seq_length = max_seq_length
        self.batch_size = batch_size
        self.device = device
        self.encoded_sentences: list[str] = []
        self.device = device.lower()
        assert_model_on_cpu(self.model)
        disable_model_cache(self.model)
        self.model.eval()

    @property
    def config(self):
        return getattr(self.model, "config", None)

    def parameters(self):
        return self.model.parameters()

    def encode(
        self,
        sentences: Sequence[str],
        *,
        normalize_embeddings: bool = True,
        batch_size: int | None = None,
        convert_to_tensor: bool = False,
        show_progress_bar: bool = False,
        **kwargs: Any,
    ) -> Any:
        texts = [str(text) for text in sentences]
        self.encoded_sentences.extend(texts)

        result_batch: list[list[float]] = []
        step = batch_size or self.batch_size or len(texts) or 1
        for start in range(0, len(texts), step):
            chunk = texts[start : start + step]
            encoded = self.tokenizer(
                chunk,
                padding=True,
                truncation=True,
                max_length=self.max_seq_length,
                return_tensors="pt",
            )
            chunk_tensors = {}
            for name, tensor in encoded.items():
                if hasattr(tensor, "to"):
                    tensor = tensor.to(device=self.device)
                chunk_tensors[name] = tensor
            attention_mask = chunk_tensors["attention_mask"]

            with torch.inference_mode():
                outputs = self.model(**chunk_tensors)
                pooled = last_token_pool(outputs.last_hidden_state, attention_mask)
                if normalize_embeddings:
                    pooled = _normalize_embeddings(pooled)
                else:
                    pooled = pooled.to(dtype=torch.float32)

            row_major = pooled.detach().to(device="cpu", dtype=torch.float32)
            result_batch.extend(row_major.tolist())

        if convert_to_tensor:
            return torch.tensor(result_batch, dtype=torch.float32)
        return result_batch
