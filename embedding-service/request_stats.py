from __future__ import annotations

from threading import Lock
from time import perf_counter
from typing import Callable


class EmbeddingRequestStats:
    def __init__(self, clock: Callable[[], float] = perf_counter):
        self._clock = clock
        self._started = clock()
        self._lock = Lock()
        self._query_requests = 0
        self._queries_embedded = 0
        self._document_requests = 0
        self._documents_embedded = 0
        self._last_document_batch_size = 0
        self._query_inference_ms = 0.0
        self._document_inference_ms = 0.0
        self._last_activity = self._started

    def record_query(self, *, inference_ms: float) -> dict[str, object]:
        with self._lock:
            self._query_requests += 1
            self._queries_embedded += 1
            self._query_inference_ms += max(0.0, float(inference_ms))
            self._last_activity = self._clock()
            return self._snapshot_locked(now=self._last_activity)

    def record_documents(self, *, count: int, inference_ms: float) -> dict[str, object]:
        if count < 0:
            raise ValueError("count must be non-negative")
        with self._lock:
            self._document_requests += 1
            self._documents_embedded += int(count)
            self._last_document_batch_size = int(count)
            self._document_inference_ms += max(0.0, float(inference_ms))
            self._last_activity = self._clock()
            return self._snapshot_locked(now=self._last_activity)

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return self._snapshot_locked(now=self._clock())

    def _snapshot_locked(self, *, now: float) -> dict[str, object]:
        query_ms = round(self._query_inference_ms, 3)
        document_ms = round(self._document_inference_ms, 3)
        return {
            "query_requests": self._query_requests,
            "queries_embedded": self._queries_embedded,
            "document_requests": self._document_requests,
            "documents_embedded": self._documents_embedded,
            "last_document_batch_size": self._last_document_batch_size,
            "query_inference_ms": query_ms,
            "document_inference_ms": document_ms,
            "total_inference_ms": round(query_ms + document_ms, 3),
            "uptime_seconds": round(max(0.0, now - self._started), 3),
        }
