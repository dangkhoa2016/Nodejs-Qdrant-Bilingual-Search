import unittest

import torch

from transformers_engine import TransformersEmbeddingModel


class FakeConfig:
    hidden_size = 2560
    model_type = "qwen3"
    num_hidden_layers = 36
    use_cache = True


class FakeParam:
    def __init__(self):
        self.dtype = torch.float16
        self.device = torch.device("cpu")


class FakeModel:
    def __init__(self, hidden=2560):
        self.config = FakeConfig()
        self._params = [FakeParam()]
        self.hidden = hidden
        self.use_cache_after_load = True

    def parameters(self):
        return iter(self._params)

    def eval(self):
        return self

    @property
    def device(self):
        return torch.device("cpu")

    def __call__(self, **encoded):
        self.use_cache_after_load = self.config.use_cache
        # Build hidden states of shape [batch, seq, hidden] (left padded -> last position is EOS)
        batch = encoded["input_ids"].shape[0]
        seq = encoded["input_ids"].shape[1]
        hidden = torch.randn(batch, seq, self.hidden, dtype=torch.float16)
        outputs = type("Outputs", (), {"last_hidden_state": hidden})()
        return outputs


class FakeTokenizer:
    def __init__(self, seq=5):
        self.seq = seq

    def __call__(self, texts, **kwargs):
        batch = len(texts)
        return {
            "input_ids": torch.zeros(batch, self.seq, dtype=torch.long),
            "attention_mask": torch.ones(batch, self.seq, dtype=torch.long),
        }


class TransformersEngineTest(unittest.TestCase):
    def test_encode_fp16_cpu_returns_finite_float32_normalized_dimension(self):
        model = FakeModel()
        tokenizer = FakeTokenizer()
        adapter = TransformersEmbeddingModel(model, tokenizer, max_seq_length=5, batch_size=1, device="cpu")
        vectors = adapter.encode(["thủ đô của Nhật Bản"])
        self.assertEqual(len(vectors), 1)
        self.assertEqual(len(vectors[0]), 2560)
        for value in vectors[0]:
            self.assertTrue(value == value, "vector contains NaN")
        tensor = torch.tensor(vectors[0])
        self.assertTrue(torch.allclose(tensor.norm(p=2), torch.tensor(1.0), atol=1e-4))

    def test_cpu_only_invariant_and_cache_disabled_are_enforced(self):
        model = FakeModel()
        adapter = TransformersEmbeddingModel(model, FakeTokenizer(), max_seq_length=5, batch_size=1, device="cpu")
        adapter.encode(["hello"], normalize_embeddings=True)
        self.assertFalse(model.config.use_cache)
        self.assertEqual(model.device.type, "cpu")

    def test_encode_returns_one_vector_per_input(self):
        model = FakeModel()
        adapter = TransformersEmbeddingModel(model, FakeTokenizer(), max_seq_length=5, batch_size=1, device="cpu")
        vectors = adapter.encode(["a", "b", "c"])
        self.assertEqual(len(vectors), 3)
        self.assertTrue(all(len(v) == 2560 for v in vectors))


if __name__ == "__main__":
    unittest.main()
