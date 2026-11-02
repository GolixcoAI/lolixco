"""
Comprehensive unit and integration tests for the Lolixco Recommendation API.

Tests:
- API health (/api/v1/health) and readiness (/api/v1/ready)
- Cold-start Home recommendations
- Up Next recommendations for Edit ID 0
- Active video suppression from Up Next
- Valid candidate exclusions (exclude_edit_ids)
- Invalid/unknown current IDs (404)
- Missing current_edit_id for up_next (422)
- Malformed requests & extra fields (422)
- Strict type validation: reject boolean, float, and stringified numeric IDs
- Category filter validation (canonical vs invalid)
- Request limit bounds (ge=1, le=50)
- Empty eligible results
- Deterministic repeated responses
- Reason codes and diagnostics
- Mode handling (auto, baseline, neural -> 503)
- Backend readiness failure when catalog is corrupt or missing
"""

import asyncio
import json
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient
import httpx

from server.recsys.api import app, create_app
from server.recsys.catalog import load_catalog_from_json

SNAPSHOT_PATH = Path(__file__).parent.parent / "catalog_snapshot.json"


class TestRecommendationAPI(unittest.TestCase):
    """Test suite for /api/v1 endpoints."""

    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_health_endpoint(self) -> None:
        """Test GET /api/v1/health returns 200 with service metadata."""
        resp = self.client.get("/api/v1/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["service"], "lolixco-recsys")
        self.assertIn("timestamp", data)

    def test_ready_endpoint_healthy(self) -> None:
        """Test GET /api/v1/ready returns 200 and catalog info."""
        resp = self.client.get("/api/v1/ready")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ready")
        self.assertEqual(data["catalog_version"], "demo-catalog-v1")
        self.assertEqual(data["policy_version"], "baseline-v1")
        self.assertEqual(data["total_edits"], 17)

    def test_ready_endpoint_unhealthy_when_catalog_missing(self) -> None:
        """Test GET /api/v1/ready returns 503 and never leaks filesystem paths or raw exceptions."""
        sensitive_path = "/var/private/secrets/company_credentials/catalog_snapshot.json"
        broken_app = create_app(catalog_path=sensitive_path)
        client = TestClient(broken_app)
        resp = client.get("/api/v1/ready")
        self.assertEqual(resp.status_code, 503)
        data = resp.json()
        self.assertEqual(data["detail"], "Recommendation engine not ready: catalog initialization failed")
        # Ensure sensitive path is NEVER disclosed in the HTTP response
        self.assertNotIn("secrets", resp.text)
        self.assertNotIn("company_credentials", resp.text)
        self.assertNotIn("catalog_snapshot.json", resp.text)

    def test_cold_start_home_recommendations(self) -> None:
        """Test POST /api/v1/recommendations for home surface with cold-start."""
        payload = {
            "surface": "home",
            "limit": 6,
        }
        resp = self.client.post("/api/v1/recommendations", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertEqual(data["surface"], "home")
        self.assertEqual(data["schema_version"], "1.0")
        self.assertEqual(data["mode_used"], "baseline")
        self.assertEqual(len(data["items"]), 6)
        self.assertEqual(data["total_eligible"], 17)
        self.assertFalse(data["has_more"])
        self.assertIsNone(data["next_cursor"])

        # Check ranks and reason codes
        for idx, item in enumerate(data["items"], start=1):
            self.assertEqual(item["rank"], idx)
            self.assertIn("cold_start", item["reason_codes"])
            self.assertIn("category_balance", item["reason_codes"])
            self.assertIsInstance(item["edit"], dict)
            self.assertIsInstance(item["edit"]["id"], int)
            self.assertIsInstance(item["edit"]["title"], str)

    def test_up_next_for_edit_id_zero(self) -> None:
        """Test POST /api/v1/recommendations for up_next surface with edit ID 0."""
        payload = {
            "surface": "up_next",
            "current_edit_id": 0,
            "limit": 4,
        }
        resp = self.client.post("/api/v1/recommendations", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertEqual(data["surface"], "up_next")
        self.assertEqual(len(data["items"]), 4)
        # Edit 0 must NEVER appear in Up Next for Edit 0
        returned_ids = [item["edit_id"] for item in data["items"]]
        self.assertNotIn(0, returned_ids)
        self.assertEqual(data["total_eligible"], 16)

    def test_up_next_requires_current_edit_id(self) -> None:
        """Test that surface=up_next without current_edit_id returns 422."""
        payload = {
            "surface": "up_next",
            "limit": 4,
        }
        resp = self.client.post("/api/v1/recommendations", json=payload)
        self.assertEqual(resp.status_code, 422)

    def test_up_next_unknown_current_edit_id_returns_404(self) -> None:
        """Test that surface=up_next with an ID outside catalog returns 404."""
        payload = {
            "surface": "up_next",
            "current_edit_id": 9999,
            "limit": 4,
        }
        resp = self.client.post("/api/v1/recommendations", json=payload)
        self.assertEqual(resp.status_code, 404)
        self.assertIn("not found in catalog", resp.json()["detail"])

    def test_active_video_suppression_and_exclusions(self) -> None:
        """Test candidate exclusion parameter exclude_edit_ids."""
        payload = {
            "surface": "up_next",
            "current_edit_id": 0,
            "exclude_edit_ids": [1, 2, 3],
            "limit": 4,
        }
        resp = self.client.post("/api/v1/recommendations", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        returned_ids = [item["edit_id"] for item in data["items"]]
        self.assertNotIn(0, returned_ids)
        self.assertNotIn(1, returned_ids)
        self.assertNotIn(2, returned_ids)
        self.assertNotIn(3, returned_ids)
        self.assertEqual(data["total_eligible"], 13)

    def test_category_filter_canonical_and_invalid(self) -> None:
        """Test category filter matching and error handling."""
        # Valid category (case-insensitive)
        payload = {
            "surface": "home",
            "filters": {"category": "cinematic"},
            "limit": 10,
        }
        resp = self.client.post("/api/v1/recommendations", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        for item in data["items"]:
            self.assertEqual(item["edit"]["category"], "Cinematic")

        # Invalid category returns 422
        bad_payload = {
            "surface": "home",
            "filters": {"category": "NonExistentCategory"},
        }
        bad_resp = self.client.post("/api/v1/recommendations", json=bad_payload)
        self.assertEqual(bad_resp.status_code, 422)

    def test_strict_type_validation_rejects_bool_float_string_ids(self) -> None:
        """Strict validation must reject boolean, float, and stringified numeric IDs."""
        # Boolean current_edit_id (Python bool is subclass of int, but JSON bool is boolean)
        resp_bool = self.client.post("/api/v1/recommendations", json={"surface": "up_next", "current_edit_id": True})
        self.assertEqual(resp_bool.status_code, 422)

        # String current_edit_id
        resp_str = self.client.post("/api/v1/recommendations", json={"surface": "up_next", "current_edit_id": "0"})
        self.assertEqual(resp_str.status_code, 422)

        # Float current_edit_id
        resp_float = self.client.post("/api/v1/recommendations", json={"surface": "up_next", "current_edit_id": 1.5})
        self.assertEqual(resp_float.status_code, 422)

        # Negative ID
        resp_neg = self.client.post("/api/v1/recommendations", json={"surface": "up_next", "current_edit_id": -1})
        self.assertEqual(resp_neg.status_code, 422)

        # Boolean in exclude_edit_ids
        resp_exclude = self.client.post(
            "/api/v1/recommendations",
            json={"surface": "home", "exclude_edit_ids": [True]},
        )
        self.assertEqual(resp_exclude.status_code, 422)

    def test_extra_fields_rejected(self) -> None:
        """Unknown fields must be rejected (extra='forbid')."""
        payload = {
            "surface": "home",
            "limit": 5,
            "unexpected_parameter": "value",
        }
        resp = self.client.post("/api/v1/recommendations", json=payload)
        self.assertEqual(resp.status_code, 422)

    def test_limit_bounds_and_rejection(self) -> None:
        """Limit must be between 1 and 50."""
        # Limit 0 -> 422
        self.assertEqual(
            self.client.post("/api/v1/recommendations", json={"surface": "home", "limit": 0}).status_code,
            422,
        )
        # Limit 51 -> 422
        self.assertEqual(
            self.client.post("/api/v1/recommendations", json={"surface": "home", "limit": 51}).status_code,
            422,
        )
        # Limit 1 -> 200
        resp1 = self.client.post("/api/v1/recommendations", json={"surface": "home", "limit": 1})
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(len(resp1.json()["items"]), 1)

    def test_empty_eligible_results(self) -> None:
        """When all items are excluded, return 200 with 0 items."""
        all_ids = list(range(17))
        payload = {
            "surface": "home",
            "exclude_edit_ids": all_ids,
        }
        resp = self.client.post("/api/v1/recommendations", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["items"], [])
        self.assertEqual(data["total_eligible"], 0)

    def test_deterministic_repeated_responses(self) -> None:
        """Identical requests must yield identical rankings and scores."""
        payload = {"surface": "home", "limit": 8}
        resp1 = self.client.post("/api/v1/recommendations", json=payload).json()
        resp2 = self.client.post("/api/v1/recommendations", json=payload).json()

        ids1 = [item["edit_id"] for item in resp1["items"]]
        ids2 = [item["edit_id"] for item in resp2["items"]]
        self.assertEqual(ids1, ids2)

        scores1 = [item["score"] for item in resp1["items"]]
        scores2 = [item["score"] for item in resp2["items"]]
        self.assertEqual(scores1, scores2)

    def test_neural_mode_returns_503(self) -> None:
        """Explicit neural mode in Stage 1 must cleanly return 503."""
        payload = {"surface": "home", "mode": "neural"}
        resp = self.client.post("/api/v1/recommendations", json=payload)
        self.assertEqual(resp.status_code, 503)
        self.assertIn("Neural recommendation mode is not available", resp.json()["detail"])

    def test_tags_all_strict_filtering(self) -> None:
        """Test that filters.tags_all strictly filters candidates and never returns unrelated edits."""
        # 1. Matching tags: 'cinematic' and 'landscape'
        resp_match = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "filters": {"tags_all": ["cinematic", "landscape"]},
                "limit": 10,
            },
        )
        self.assertEqual(resp_match.status_code, 200)
        data_match = resp_match.json()
        self.assertGreater(len(data_match["items"]), 0)
        for item in data_match["items"]:
            tags = [t.lower() for t in item["edit"]["tags"]]
            self.assertIn("cinematic", tags)
            self.assertIn("landscape", tags)

        # 2. Nonexistent or unmatched tag: must return 200 with empty items, NEVER unrelated edits
        resp_none = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "filters": {"tags_all": ["nonexistent_impossible_tag_12345"]},
                "limit": 10,
            },
        )
        self.assertEqual(resp_none.status_code, 200)
        data_none = resp_none.json()
        self.assertEqual(data_none["items"], [])
        self.assertEqual(data_none["total_eligible"], 0)

        # 3. Malformed empty tag -> 422
        resp_empty_tag = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "filters": {"tags_all": [""]},
            },
        )
        self.assertEqual(resp_empty_tag.status_code, 422)

        # 4. Tag exceeding 64 chars -> 422
        resp_long_tag = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "filters": {"tags_all": ["a" * 65]},
            },
        )
        self.assertEqual(resp_long_tag.status_code, 422)

        # 5. More than 10 tags -> 422
        resp_too_many = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "filters": {"tags_all": [f"tag_{i}" for i in range(11)]},
            },
        )
        self.assertEqual(resp_too_many.status_code, 422)

    def test_watch_history_rfc3339_validation(self) -> None:
        """Test strict RFC3339 timestamp and bounded watch time validation for session history."""
        # Valid RFC3339 timestamp with Z
        resp_valid_z = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "context": {
                    "history": [
                        {
                            "edit_id": 0,
                            "unique_watch_ms": 12000,
                            "occurred_at": "2026-10-17T12:00:00Z",
                        }
                    ]
                },
            },
        )
        self.assertEqual(resp_valid_z.status_code, 200)

        # Valid RFC3339 timestamp with timezone offset (+05:30)
        resp_valid_offset = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "context": {
                    "history": [
                        {
                            "edit_id": 0,
                            "unique_watch_ms": 12000,
                            "occurred_at": "2026-10-17T17:30:00+05:30",
                        }
                    ]
                },
            },
        )
        self.assertEqual(resp_valid_offset.status_code, 200)

        # Malformed non-timestamp string -> 422
        resp_bad_str = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "context": {
                    "history": [
                        {
                            "edit_id": 0,
                            "unique_watch_ms": 5000,
                            "occurred_at": "yesterday",
                        }
                    ]
                },
            },
        )
        self.assertEqual(resp_bad_str.status_code, 422)

        # Missing timezone offset -> 422
        resp_no_tz = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "context": {
                    "history": [
                        {
                            "edit_id": 0,
                            "unique_watch_ms": 5000,
                            "occurred_at": "2026-10-17T12:00:00",
                        }
                    ]
                },
            },
        )
        self.assertEqual(resp_no_tz.status_code, 422)

        # ISO week date (must be rejected by strict RFC3339) -> 422
        resp_week = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "context": {
                    "history": [
                        {
                            "edit_id": 0,
                            "unique_watch_ms": 5000,
                            "occurred_at": "2026-W42-6T12:34:56+00:00",
                        }
                    ]
                },
            },
        )
        self.assertEqual(resp_week.status_code, 422)

        # Space separator instead of 'T' (must be rejected by strict RFC3339) -> 422
        resp_space = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "context": {
                    "history": [
                        {
                            "edit_id": 0,
                            "unique_watch_ms": 5000,
                            "occurred_at": "2026-10-17 12:34:56+00:00",
                        }
                    ]
                },
            },
        )
        self.assertEqual(resp_space.status_code, 422)

        # Invalid calendar date (Feb 31) -> 422
        resp_bad_date = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "context": {
                    "history": [
                        {
                            "edit_id": 0,
                            "unique_watch_ms": 5000,
                            "occurred_at": "2026-02-31T12:00:00Z",
                        }
                    ]
                },
            },
        )
        self.assertEqual(resp_bad_date.status_code, 422)

        # Unbounded length string -> 422
        resp_huge_str = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "context": {
                    "history": [
                        {
                            "edit_id": 0,
                            "unique_watch_ms": 5000,
                            "occurred_at": "2026-10-17T12:00:00Z" + "0" * 100,
                        }
                    ]
                },
            },
        )
        self.assertEqual(resp_huge_str.status_code, 422)

        # Exceeding maximum watch time bound (3600000ms = 1hr) -> 422
        resp_exceeded_watch = self.client.post(
            "/api/v1/recommendations",
            json={
                "surface": "home",
                "context": {
                    "history": [
                        {
                            "edit_id": 0,
                            "unique_watch_ms": 3600001,
                            "occurred_at": "2026-10-17T12:00:00Z",
                        }
                    ]
                },
            },
        )
        self.assertEqual(resp_exceeded_watch.status_code, 422)

        # Surrounding whitespace rejected -> 422
        for ws_ts in [
            " 2026-10-17T12:34:56Z",
            "2026-10-17T12:34:56Z ",
            "\t2026-10-17T12:34:56Z\n",
        ]:
            with self.subTest(ts=ws_ts):
                resp_ws = self.client.post(
                    "/api/v1/recommendations",
                    json={
                        "surface": "home",
                        "context": {
                            "history": [
                                {
                                    "edit_id": 0,
                                    "unique_watch_ms": 5000,
                                    "occurred_at": ws_ts,
                                }
                            ]
                        },
                    },
                )
                self.assertEqual(resp_ws.status_code, 422)

        # Valid RFC3339 timestamps (Z, numeric offset, fractional seconds) -> 200
        for valid_ts in [
            "2026-10-17T12:34:56Z",
            "2026-10-17T12:34:56+00:00",
            "2026-10-17T05:34:56.123456-07:00",
        ]:
            resp_ok = self.client.post(
                "/api/v1/recommendations",
                json={
                    "surface": "home",
                    "context": {
                        "history": [
                            {
                                "edit_id": 0,
                                "unique_watch_ms": 5000,
                                "occurred_at": valid_ts,
                            }
                        ]
                    },
                },
            )
            self.assertEqual(resp_ok.status_code, 200, f"Failed for valid ts: {valid_ts}")

    def test_request_body_size_limit_rejection(self) -> None:
        """Payload exceeding 64KB must be incrementally rejected with 413."""
        # 1. Declared oversized Content-Length -> 413
        large_history = [
            {
                "edit_id": i % 17,
                "unique_watch_ms": 1000,
                "occurred_at": "2026-10-17T12:00:00Z",
            }
            for i in range(2000)  # ~140KB payload
        ]
        resp = self.client.post(
            "/api/v1/recommendations",
            json={"surface": "home", "context": {"history": large_history}},
        )
        self.assertEqual(resp.status_code, 413)
        self.assertIn("Request body too large", resp.json()["detail"])

        # 2. Streamed chunks without Content-Length exceeding 64KB -> 413
        chunks_sent = [0]

        async def stream_oversized():
            for _ in range(5):
                chunks_sent[0] += 1
                yield b"x" * 20_000  # 5 * 20KB = 100KB > 64KB

        async def run_stream_test():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                return await ac.post(
                    "/api/v1/recommendations",
                    content=stream_oversized(),
                    headers={"Content-Type": "application/json"},
                )

        resp_stream = asyncio.run(run_stream_test())
        self.assertEqual(resp_stream.status_code, 413)
        self.assertIn("Request body too large", resp_stream.json()["detail"])
        # Incremental cutoff must stop reading before consuming all 5 chunks (4 chunks * 20KB = 80KB > 64KB)
        self.assertLess(chunks_sent[0], 5)

        # 3. Small valid body succeeds -> 200
        resp_small = self.client.post(
            "/api/v1/recommendations",
            json={"surface": "home", "limit": 2},
        )
        self.assertEqual(resp_small.status_code, 200)


if __name__ == "__main__":
    unittest.main()

class TestCatalogVersionConfiguration(unittest.TestCase):
    def test_catalog_v2_file_loads_only_with_matching_configuration(self):
        data = json.loads(SNAPSHOT_PATH.read_text())
        data['catalog_version'] = 'catalog-v2'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'catalog.json'
            path.write_text(json.dumps(data))
            self.assertEqual(TestClient(create_app(catalog_path=path)).get('/api/v1/ready').status_code, 503)
            with TestClient(create_app(catalog_path=path, catalog_version='catalog-v2')) as client:
                self.assertEqual(client.get('/api/v1/ready').json()['catalog_version'], 'catalog-v2')
                response = client.post('/api/v1/recommendations', json={'surface':'home','limit':4})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['catalog_version'], 'catalog-v2')

    def test_environment_version_and_unsupported_version_fail_closed(self):
        from unittest.mock import patch
        with patch.dict('os.environ', {'LOLIXCO_CATALOG_VERSION':'catalog-v2'}):
            self.assertEqual(TestClient(create_app()).get('/api/v1/ready').status_code, 503)
            self.assertEqual(TestClient(create_app(catalog_version='demo-catalog-v1')).get('/api/v1/ready').status_code, 200)
        with self.assertRaises(ValueError):
            create_app(catalog_version='accept-anything')
        catalog = load_catalog_from_json(SNAPSHOT_PATH)
        with self.assertRaises(ValueError):
            create_app(catalog=catalog, catalog_version='catalog-v2')
