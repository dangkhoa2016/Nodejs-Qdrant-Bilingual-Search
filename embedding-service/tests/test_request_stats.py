import unittest

from request_stats import EmbeddingRequestStats


class RequestStatsTest(unittest.TestCase):
    def test_tracks_successful_query_and_document_batches(self):
        now_values = iter([100.0, 101.5, 103.0, 104.0])
        stats = EmbeddingRequestStats(clock=lambda: next(now_values))

        stats.record_query(inference_ms=12.5)
        stats.record_documents(count=8, inference_ms=80.0)

        snapshot = stats.snapshot()
        self.assertEqual(snapshot["query_requests"], 1)
        self.assertEqual(snapshot["queries_embedded"], 1)
        self.assertEqual(snapshot["document_requests"], 1)
        self.assertEqual(snapshot["documents_embedded"], 8)
        self.assertEqual(snapshot["last_document_batch_size"], 8)
        self.assertEqual(snapshot["total_inference_ms"], 92.5)
        self.assertEqual(snapshot["document_inference_ms"], 80.0)
        self.assertEqual(snapshot["query_inference_ms"], 12.5)
        self.assertEqual(snapshot["uptime_seconds"], 4.0)


if __name__ == "__main__":
    unittest.main()
