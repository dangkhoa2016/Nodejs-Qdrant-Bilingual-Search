import unittest

from engine import EmbeddingConfig, EmbeddingEngine


class FakeModel:
    def __init__(self, dimension=3):
        self.dimension = dimension
        self.calls = []

    def encode(self, sentences, **kwargs):
        self.calls.append((list(sentences), kwargs))
        return [[float(i) for i in range(self.dimension)] for _ in sentences]


class EmbeddingEngineTest(unittest.TestCase):
    def test_query_uses_e5_query_prefix_and_normalization(self):
        model = FakeModel()
        engine = EmbeddingEngine(model, EmbeddingConfig(model_name="fake", dimension=3))
        self.assertEqual(engine.embed_query("  xin chào  "), [0.0, 1.0, 2.0])
        texts, kwargs = model.calls[0]
        self.assertEqual(texts, ["query: xin chào"])
        self.assertTrue(kwargs["normalize_embeddings"])

    def test_documents_use_passage_prefix_in_one_batch(self):
        model = FakeModel()
        engine = EmbeddingEngine(model, EmbeddingConfig(model_name="fake", dimension=3))
        vectors = engine.embed_documents(["Thailand", "Việt Nam"])
        self.assertEqual(len(vectors), 2)
        self.assertEqual(model.calls[0][0], ["passage: Thailand", "passage: Việt Nam"])
        self.assertEqual(len(model.calls), 1)

    def test_qwen_query_uses_instruction_prompt_without_e5_prefix(self):
        model = FakeModel()
        engine = EmbeddingEngine(
            model,
            EmbeddingConfig(
                model_name="Qwen/Qwen3-Embedding-4B",
                dimension=3,
                profile="qwen3",
                query_strategy="prompt",
                document_strategy="raw",
                query_prompt="Instruct: Retrieve the geographic entity\nQuery:",
                query_instruction_id="geo-retrieval-v1:test",
                batch_size=8,
            ),
        )
        engine.embed_query("  thủ đô của Nhật Bản  ")
        texts, kwargs = model.calls[0]
        self.assertEqual(texts, ["thủ đô của Nhật Bản"])
        self.assertEqual(kwargs["prompt"], "Instruct: Retrieve the geographic entity\nQuery:")
        self.assertTrue(kwargs["normalize_embeddings"])
        self.assertEqual(kwargs["batch_size"], 8)

    def test_qwen_documents_are_embedded_raw_without_query_prompt(self):
        model = FakeModel()
        engine = EmbeddingEngine(
            model,
            EmbeddingConfig(
                model_name="Qwen/Qwen3-Embedding-4B",
                dimension=3,
                profile="qwen3",
                query_strategy="prompt",
                document_strategy="raw",
                query_prompt="Instruct: Retrieve the geographic entity\nQuery:",
                query_instruction_id="geo-retrieval-v1:test",
            ),
        )
        engine.embed_documents(["Tokyo is the capital of Japan.", "Bangkok is the capital of Thailand."])
        texts, kwargs = model.calls[0]
        self.assertEqual(texts, ["Tokyo is the capital of Japan.", "Bangkok is the capital of Thailand."])
        self.assertNotIn("prompt", kwargs)

    def test_dimension_mismatch_fails_fast(self):
        engine = EmbeddingEngine(FakeModel(dimension=2), EmbeddingConfig(model_name="fake", dimension=3))
        with self.assertRaisesRegex(ValueError, "dimension 3"):
            engine.embed_query("hello")


if __name__ == "__main__":
    unittest.main()
