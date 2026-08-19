from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence


class TranslatorBackend(Protocol):
    def translate(self, texts: Sequence[str]) -> Sequence[str]: ...


@dataclass(frozen=True)
class TranslationConfig:
    model_name: str = "Helsinki-NLP/opus-mt-en-vi"
    source_language: str = "en"
    target_language: str = "vi"


class TranslationEngine:
    """Strict EN->VI translation boundary used only as an optional dataset fallback."""

    def __init__(self, backend: TranslatorBackend, config: TranslationConfig):
        self.backend = backend
        self.config = config

    def translate(self, text: str, source_language: str = "en", target_language: str = "vi") -> str:
        if source_language != self.config.source_language or target_language != self.config.target_language:
            raise ValueError("translator supports en -> vi only")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("translation text must be a non-empty string")
        translated = list(self.backend.translate([text.strip()]))
        if len(translated) != 1 or not isinstance(translated[0], str) or not translated[0].strip():
            raise ValueError("translation backend returned an invalid result")
        return translated[0].strip()


class MarianBackend:
    """Lazy Hugging Face Marian adapter; imported only when translation is enabled."""

    def __init__(self, model_name: str, target_token: str = ">>vie<<"):
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

        self.target_token = target_token.strip()
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
        self.model.eval()

    def translate(self, texts: Sequence[str]) -> Sequence[str]:
        prepared = [f"{self.target_token} {text}".strip() for text in texts]
        batch = self.tokenizer(prepared, return_tensors="pt", padding=True, truncation=True)
        generated = self.model.generate(**batch, max_new_tokens=256)
        return self.tokenizer.batch_decode(generated, skip_special_tokens=True)
