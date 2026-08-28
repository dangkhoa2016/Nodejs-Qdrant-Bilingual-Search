from __future__ import annotations


def embedding_runtime_identity(**details: object) -> dict[str, object]:
    identity: dict[str, object] = {
        "backend": "sentence-transformers",
        "implementation": "python-fastapi",
        "semantic": True,
    }
    for key in (
        "accelerator",
        "device",
        "dtype",
        "runtime",
        "profile",
        "query_strategy",
        "query_instruction_id",
        "document_strategy",
    ):
        value = details.get(key)
        if value is not None and str(value).strip():
            identity[key] = value
    return identity
