import unittest

from translation_engine import TranslationConfig, TranslationEngine


class FakeBackend:
    def __init__(self, output=None):
        self.calls = []
        self.output = output or ["quốc gia ở Đông Nam Á"]

    def translate(self, texts):
        self.calls.append(list(texts))
        return self.output


class TranslationEngineTest(unittest.TestCase):
    def test_translates_one_trimmed_english_input(self):
        backend = FakeBackend()
        engine = TranslationEngine(backend, TranslationConfig())
        self.assertEqual(engine.translate("  country in Southeast Asia  "), "quốc gia ở Đông Nam Á")
        self.assertEqual(backend.calls, [["country in Southeast Asia"]])

    def test_rejects_wrong_direction_before_backend_call(self):
        backend = FakeBackend()
        engine = TranslationEngine(backend, TranslationConfig())
        with self.assertRaisesRegex(ValueError, "en -> vi"):
            engine.translate("xin chào", "vi", "en")
        self.assertEqual(backend.calls, [])

    def test_rejects_empty_backend_output(self):
        engine = TranslationEngine(FakeBackend([""]), TranslationConfig())
        with self.assertRaisesRegex(ValueError, "invalid result"):
            engine.translate("hello")


if __name__ == "__main__":
    unittest.main()
