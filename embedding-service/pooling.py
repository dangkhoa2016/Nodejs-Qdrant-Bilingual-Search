from __future__ import annotations

from collections.abc import Sequence

import torch
import torch.nn.functional as F


def format_query(text: str, prompt_prefix: str) -> str:
    return f"{prompt_prefix}{text}"


def format_documents(texts: Sequence[str]) -> list[str]:
    return list(texts)


def last_token_pool(
    last_hidden_states: torch.Tensor, attention_mask: torch.Tensor
) -> torch.Tensor:
    if last_hidden_states.ndim != 3:
        raise ValueError("last_hidden_states must have shape [batch, seq, hidden]")
    if attention_mask.ndim != 2:
        raise ValueError("attention_mask must have shape [batch, seq]")
    if last_hidden_states.shape[:2] != attention_mask.shape:
        raise ValueError("hidden states and attention mask shapes are incompatible")

    left_padded = bool(torch.all(attention_mask[:, -1] == 1).item())
    if left_padded:
        return last_hidden_states[:, -1]

    sequence_lengths = attention_mask.sum(dim=1) - 1
    batch_indices = torch.arange(
        last_hidden_states.shape[0], device=last_hidden_states.device
    )
    return last_hidden_states[batch_indices, sequence_lengths]


def normalize_embeddings(embeddings: torch.Tensor) -> torch.Tensor:
    return F.normalize(embeddings.to(dtype=torch.float32), p=2, dim=1)
