"""Synthetic category tests; no production catalog mutation."""
import unittest
from server.recsys.api import FiltersModel
from server.recsys.catalog import Catalog
from server.recsys.engine import RecommendationEngine
from server.recsys.types import EditItem, RecommendationRequest


def item(edit_id, category, tags):
    return EditItem(id=edit_id, title=f"Synthetic {edit_id}", category=category,
                    tags=tags, description="Synthetic fixture", creator=f"Creator {edit_id}",
                    poster="/p.svg", source="/v.webm", duration="0:12",
                    duration_ms=12000, duration_sec=12.0, trending=False)


class MotivationTests(unittest.TestCase):
    def test_api_normalization_and_category_filtered_recommendations(self):
        self.assertEqual(FiltersModel(category="motivation").category, "Motivation")
        catalog = Catalog([item(1, "Motivation", ("training", "resolve")),
                           item(2, "Motivation", ("training", "focus")),
                           item(3, "Gaming", ("gaming", "action"))])
        engine = RecommendationEngine(catalog)
        result = engine.recommend(RecommendationRequest(surface="home", category_filter="Motivation", limit=10))
        self.assertEqual({x.edit.id for x in result.items}, {1, 2})
        result = engine.recommend(RecommendationRequest(surface="up_next", current_edit_id=1, limit=10))
        self.assertEqual(result.items[0].edit.id, 2)
        self.assertIn("category_match", result.items[0].reason_codes)
