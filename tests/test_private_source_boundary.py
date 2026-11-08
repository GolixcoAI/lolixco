"""Prevent one-off private owner evaluations from being embedded in source."""

import ast
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_EVALUATION_FIELDS = {
    "owner_rating_range", "owner_rating_midpoint", "owner_judgment", "evaluation_notes",
}


def private_literal_locations(source):
    locations = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Dict):
            continue
        try:
            value = ast.literal_eval(node)
        except (ValueError, TypeError):
            continue
        if isinstance(value, dict) and len(PRIVATE_EVALUATION_FIELDS.intersection(value)) >= 2:
            locations.append(node.lineno)
    return locations


class PrivateSourceBoundaryTests(unittest.TestCase):
    def test_literal_owner_evaluation_is_detected_without_echoing_its_values(self):
        source = "feedback = {'owner_rating_midpoint': 1.0, 'owner_judgment': 'synthetic regression fixture'}"
        self.assertEqual(private_literal_locations(source), [1])
        self.assertEqual(private_literal_locations("schema = {'owner_judgment': str}"), [])

    def test_tracked_python_source_contains_no_literal_owner_evaluations(self):
        names = subprocess.check_output(["git", "ls-files", "-z", "--", "*.py"], cwd=ROOT).split(b"\0")
        violations = []
        for name in names:
            if not name:
                continue
            path = ROOT / name.decode()
            if path.is_file():
                for line in private_literal_locations(path.read_text()):
                    violations.append((str(path.relative_to(ROOT)), line))
        self.assertEqual(violations, [], "Private evaluations must remain outside tracked source.")


if __name__ == "__main__":
    unittest.main()
