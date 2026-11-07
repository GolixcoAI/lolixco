"""Configuration isolation checks with synthetic values and temporary files."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("studio_configuration", ROOT / "scripts/local-dna/configuration.py")
configuration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configuration)


class ConfigurationTests(unittest.TestCase):
    def test_blank_template_and_environment_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env.local"
            settings = configuration.load_configuration(path, {})
            self.assertEqual(settings["GEMINI_API_KEY"], "")
            self.assertEqual(settings["YOUTUBE_API_KEY"], "")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            path.write_text('GEMINI_API_KEY="SYNTHETIC_FILE_VALUE"\nYOUTUBE_API_KEY=\nLOLIXCO_GEMINI_YOUTUBE=1\n')
            settings = configuration.load_configuration(path, {"GEMINI_API_KEY": "SYNTHETIC_PROCESS_VALUE"})
            self.assertEqual(settings["GEMINI_API_KEY"], "SYNTHETIC_PROCESS_VALUE")
            self.assertEqual(settings["LOLIXCO_GEMINI_YOUTUBE"], "1")

    def test_invalid_setting_error_does_not_echo_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env.local"
            for text in ('VITE_GEMINI_API_KEY=SYNTHETIC_PRIVATE_VALUE', 'GEMINI_API_KEY="SYNTHETIC_PRIVATE_VALUE'):
                path.write_text(text)
                with self.assertRaises(RuntimeError) as raised:
                    configuration.load_configuration(path, {})
                self.assertNotIn("SYNTHETIC_PRIVATE_VALUE", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
