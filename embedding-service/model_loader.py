from __future__ import annotations

from runtime_config import RuntimeConfig


def resolve_model_load_target(model_name: str, model_path: str | None = None) -> str:
    canonical = str(model_name or "").strip()
    if not canonical:
        raise ValueError("EMBEDDING_MODEL must not be empty")
    local = str(model_path or "").strip()
    return local or canonical


def _param_dtype_name(dtype, torch_module):
    for name, kind in (
        ("float32", torch_module.float32),
        ("float16", torch_module.float16),
        ("bfloat16", torch_module.bfloat16),
    ):
        if dtype is kind:
            return name
    return None


def detect_loaded_model_dtype(model, *, torch_module) -> str:
    names = set()
    for param in model.parameters():
        name = _param_dtype_name(param.dtype, torch_module)
        if name:
            names.add(name)
    if not names:
        raise RuntimeError("embedding model has no supported floating parameters")
    if len(names) > 1:
        raise RuntimeError(f"embedding model has mixed floating parameter dtypes: {', '.join(sorted(names))}")
    return next(iter(names))


def assert_loaded_model_dtype(model, expected_dtype: str, *, torch_module) -> str:
    actual = detect_loaded_model_dtype(model, torch_module=torch_module)
    if actual != expected_dtype:
        raise RuntimeError(
            f"loaded model dtype mismatch: requested={expected_dtype} actual={actual}"
        )
    return actual


def build_sentence_transformer_kwargs(
    runtime: RuntimeConfig,
    *,
    torch_module,
    profile_name: str | None = None,
) -> dict[str, object]:
    dtype_map = {
        "float16": torch_module.float16,
        "float32": torch_module.float32,
    }
    try:
        torch_dtype = dtype_map[runtime.dtype]
    except KeyError as exc:
        raise ValueError(f"unsupported runtime dtype: {runtime.dtype}") from exc

    kwargs: dict[str, object] = {
        "device": runtime.device,
        "model_kwargs": {"torch_dtype": torch_dtype},
    }
    if profile_name == "qwen3":
        kwargs["tokenizer_kwargs"] = {"padding_side": "left"}
    return kwargs
