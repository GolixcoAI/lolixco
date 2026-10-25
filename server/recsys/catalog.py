from collections import Counter, defaultdict
import json
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from .types import EditItem


def parse_duration_to_ms(duration_str: str) -> Tuple[int, float]:
    """
    Parse a duration string into (duration_ms, duration_sec).
    Supports:
      - "M:SS" (e.g. "0:12" -> (12000, 12.0), "1:05" -> (65000, 65.0))
      - "H:MM:SS" (e.g. "1:02:03" -> (3723000, 3723.0))
      - Pure seconds as string or float (e.g. "12" -> (12000, 12.0))
    """
    if not duration_str or not isinstance(duration_str, str):
        raise ValueError(f"Invalid duration string: {duration_str!r}")

    cleaned = duration_str.strip()
    if "-" in cleaned:
        raise ValueError(f"Duration cannot be negative: {duration_str}")

    parts = cleaned.split(":")

    try:
        if len(parts) == 1:
            seconds = float(parts[0])
        elif len(parts) == 2:
            minutes = int(parts[0])
            seconds = minutes * 60 + float(parts[1])
        elif len(parts) == 3:
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = hours * 3600 + minutes * 60 + float(parts[2])
        else:
            raise ValueError(f"Too many colon segments in duration: {duration_str}")

        if seconds <= 0:
            raise ValueError(f"Parsed duration must be > 0 seconds, got {seconds}")

        duration_ms = int(round(seconds * 1000))
        duration_sec = float(round(seconds, 3))
        return duration_ms, duration_sec
    except ValueError as e:
        raise ValueError(f"Could not parse duration '{duration_str}': {e}") from e


class Catalog:
    """Validated, immutable catalog repository with fast index lookups."""

    def __init__(self, items: Sequence[EditItem], catalog_version: str = "demo-catalog-v1"):
        if not items:
            raise ValueError("Catalog cannot be empty")

        self.catalog_version = catalog_version
        self._items_by_id: Dict[int, EditItem] = {}
        self._items_ordered: List[EditItem] = []
        self._by_category: Dict[str, List[EditItem]] = defaultdict(list)
        self._by_creator: Dict[str, List[EditItem]] = defaultdict(list)
        self._tag_doc_freq: Counter[str] = Counter()

        seen_ids: Set[int] = set()

        for item in items:
            if not isinstance(item, EditItem):
                raise TypeError(f"Expected EditItem instance, got {type(item)}")

            # Invariant: ID must be a non-negative integer. Crucially ID 0 is valid.
            if item.id in seen_ids:
                raise ValueError(f"Duplicate edit ID detected: {item.id}")

            seen_ids.add(item.id)
            self._items_by_id[item.id] = item
            self._items_ordered.append(item)
            self._by_category[item.category].append(item)
            self._by_creator[item.creator].append(item)

            for tag in set(item.tags):
                self._tag_doc_freq[tag.lower()] += 1

        self._all_categories: Tuple[str, ...] = tuple(sorted(self._by_category.keys()))
        self._all_creators: Tuple[str, ...] = tuple(sorted(self._by_creator.keys()))

    def __len__(self) -> int:
        return len(self._items_by_id)

    def __contains__(self, edit_id: Any) -> bool:
        if isinstance(edit_id, bool) or type(edit_id) is bool:
            raise TypeError(f"Catalog edit_id must be strict integer, got bool: {edit_id!r}")
        if type(edit_id) is not int:
            return False
        return edit_id in self._items_by_id

    def get(self, edit_id: Any) -> Optional[EditItem]:
        """Safely fetch an edit by ID. Preserves ID 0."""
        if isinstance(edit_id, bool) or type(edit_id) is bool:
            raise TypeError(f"Catalog edit_id must be strict integer, got bool: {edit_id!r}")
        if type(edit_id) is not int:
            return None
        return self._items_by_id.get(edit_id)

    @property
    def all_items(self) -> Tuple[EditItem, ...]:
        return tuple(self._items_ordered)

    @property
    def categories(self) -> Tuple[str, ...]:
        return self._all_categories

    @property
    def creators(self) -> Tuple[str, ...]:
        return self._all_creators

    def get_by_category(self, category: str) -> Tuple[EditItem, ...]:
        return tuple(self._by_category.get(category, []))

    def get_tag_doc_freq(self, tag: str) -> int:
        return self._tag_doc_freq.get(tag.lower(), 0)

    ALLOWED_FIELDS = {
        "id",
        "title",
        "category",
        "tags",
        "description",
        "creator",
        "poster",
        "source",
        "duration",
        "trending",
        "format",
        "fandomIds",
        "sourceType",
        "youtubeVideoId",
        "channelTitle",
        "channelId",
        "sourceUrl",
    }
    REQUIRED_FIELDS = {
        "id",
        "title",
        "category",
        "tags",
        "description",
        "creator",
        "poster",
        "source",
        "duration",
    }

    @classmethod
    def from_dict_list(
        cls, raw_list: Sequence[Dict[str, Any]], catalog_version: str = "demo-catalog-v1"
    ) -> "Catalog":
        """Construct catalog from raw dictionaries with strict schema and type validation."""
        if not isinstance(raw_list, (list, tuple)):
            raise TypeError(f"Expected list/tuple of dicts for catalog, got {type(raw_list).__name__}")

        items: List[EditItem] = []
        for idx, raw in enumerate(raw_list):
            if not isinstance(raw, dict):
                raise TypeError(f"Record at index {idx} must be a dictionary, got {type(raw).__name__}")

            extra_keys = set(raw.keys()) - cls.ALLOWED_FIELDS
            if extra_keys:
                raise ValueError(f"Record at index {idx} has unexpected fields: {sorted(extra_keys)}")

            missing_keys = cls.REQUIRED_FIELDS - set(raw.keys())
            if missing_keys:
                raise ValueError(f"Record at index {idx} missing required fields: {sorted(missing_keys)}")

            raw_id = raw["id"]
            if type(raw_id) is not int or raw_id < 0:
                raise TypeError(
                    f"Record at index {idx}: 'id' must be strict non-negative integer, got {type(raw_id).__name__}: {raw_id!r}"
                )

            raw_title = raw["title"]
            if type(raw_title) is not str or not raw_title.strip():
                raise TypeError(
                    f"Record at index {idx}: 'title' must be non-empty string, got {type(raw_title).__name__}: {raw_title!r}"
                )

            raw_cat = raw["category"]
            if type(raw_cat) is not str or not raw_cat.strip():
                raise TypeError(
                    f"Record at index {idx}: 'category' must be non-empty string, got {type(raw_cat).__name__}: {raw_cat!r}"
                )

            raw_tags = raw["tags"]
            if not isinstance(raw_tags, (list, tuple)) or isinstance(raw_tags, (str, bytes)):
                raise TypeError(
                    f"Record at index {idx}: 'tags' must be a list/tuple of strings, got {type(raw_tags).__name__}: {raw_tags!r}"
                )
            cleaned_tags = []
            for t_idx, t in enumerate(raw_tags):
                if type(t) is not str or not t.strip():
                    raise TypeError(
                        f"Record at index {idx}, tag {t_idx}: must be non-empty string, got {type(t).__name__}: {t!r}"
                    )
                cleaned_tags.append(t.strip().lower())

            raw_desc = raw["description"]
            if type(raw_desc) is not str:
                raise TypeError(
                    f"Record at index {idx}: 'description' must be string, got {type(raw_desc).__name__}"
                )

            raw_creator = raw["creator"]
            if type(raw_creator) is not str or not raw_creator.strip():
                raise TypeError(
                    f"Record at index {idx}: 'creator' must be non-empty string, got {type(raw_creator).__name__}: {raw_creator!r}"
                )

            raw_poster = raw["poster"]
            if type(raw_poster) is not str or not raw_poster.strip():
                raise TypeError(
                    f"Record at index {idx}: 'poster' must be non-empty string, got {type(raw_poster).__name__}: {raw_poster!r}"
                )

            raw_source = raw["source"]
            if type(raw_source) is not str or not raw_source.strip():
                raise TypeError(
                    f"Record at index {idx}: 'source' must be non-empty string, got {type(raw_source).__name__}: {raw_source!r}"
                )

            raw_duration = raw["duration"]
            if type(raw_duration) is not str or not raw_duration.strip():
                raise TypeError(
                    f"Record at index {idx}: 'duration' must be non-empty string, got {type(raw_duration).__name__}: {raw_duration!r}"
                )
            dur_ms, dur_sec = parse_duration_to_ms(raw_duration)

            raw_trending = raw.get("trending", False)
            if type(raw_trending) is not bool:
                raise TypeError(
                    f"Record at index {idx}: 'trending' must be boolean, got {type(raw_trending).__name__}: {raw_trending!r}"
                )

            raw_format = raw.get("format", "video")
            if type(raw_format) is not str or raw_format not in ("video", "short"):
                raise ValueError(
                    f"Record at index {idx}: 'format' must be 'video' or 'short', got {raw_format!r}"
                )

            raw_fandom_ids = raw.get("fandomIds", ())
            if not isinstance(raw_fandom_ids, (list, tuple)) or isinstance(raw_fandom_ids, (str, bytes)):
                raise TypeError(
                    f"Record at index {idx}: 'fandomIds' must be a sequence of strings, got {type(raw_fandom_ids).__name__}: {raw_fandom_ids!r}"
                )
            cleaned_fandom_ids = []
            for f_idx, f_id in enumerate(raw_fandom_ids):
                if type(f_id) is not str or not f_id.strip():
                    raise TypeError(
                        f"Record at index {idx}, fandomId {f_idx}: must be non-empty string, got {type(f_id).__name__}: {f_id!r}"
                    )
                cleaned_fandom_ids.append(f_id.strip())

            raw_source_type = raw.get("sourceType", "local_demo")
            if type(raw_source_type) is not str or raw_source_type not in ("local_demo", "youtube_embed", "licensed_local_media"):
                raise ValueError(
                    f"Record at index {idx}: 'sourceType' must be 'local_demo', 'youtube_embed', or 'licensed_local_media', got {raw_source_type!r}"
                )

            raw_youtube_id = raw.get("youtubeVideoId", "")
            if type(raw_youtube_id) is not str:
                raise TypeError(
                    f"Record at index {idx}: 'youtubeVideoId' must be string, got {type(raw_youtube_id).__name__}"
                )

            for field in ("channelTitle", "channelId", "sourceUrl"):
                if field in raw and (type(raw[field]) is not str or not raw[field].strip()):
                    raise TypeError(f"{field} must be a non-empty string when present")

            item = EditItem(
                id=raw_id,
                title=raw_title.strip(),
                category=raw_cat.strip(),
                tags=tuple(cleaned_tags),
                description=raw_desc,
                creator=raw_creator.strip(),
                poster=raw_poster.strip(),
                source=raw_source.strip(),
                duration=raw_duration.strip(),
                duration_ms=dur_ms,
                duration_sec=dur_sec,
                trending=raw_trending,
                format=raw_format,
                fandom_ids=tuple(cleaned_fandom_ids),
                source_type=raw_source_type,
                youtube_video_id=raw_youtube_id,
                channel_title=raw.get("channelTitle"),
                channel_id=raw.get("channelId"),
                source_url=raw.get("sourceUrl"),
            )
            items.append(item)

        return cls(items, catalog_version=catalog_version)


def load_catalog_from_json(
    json_path: Path | str, expected_version: str = "demo-catalog-v1"
) -> Catalog:
    """
    Load and validate catalog from a JSON snapshot file with strict envelope checks.
    Enforces:
    - JSON object root.
    - Required envelope keys: catalog_version, total_edits, edits.
    - No unexpected envelope keys (only catalog_version, total_edits, edits, exported_at).
    - catalog_version matches expected_version.
    - total_edits is strict integer and matches edits array length.
    - edits is list of records validated via Catalog.from_dict_list.
    """
    path = Path(json_path)
    if not path.is_file():
        raise FileNotFoundError(f"Catalog file not found: {path}")

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise TypeError(f"Catalog JSON root must be an object, got {type(data).__name__}")

    allowed_envelope = {"catalog_version", "total_edits", "edits", "exported_at"}
    required_envelope = {"catalog_version", "total_edits", "edits"}

    extra_keys = set(data.keys()) - allowed_envelope
    if extra_keys:
        raise ValueError(f"Unexpected snapshot envelope keys: {sorted(extra_keys)}")

    missing_keys = required_envelope - set(data.keys())
    if missing_keys:
        raise ValueError(f"Missing required snapshot envelope keys: {sorted(missing_keys)}")

    version = data.get("catalog_version")
    if type(version) is not str or version != expected_version:
        raise ValueError(f"Catalog version mismatch: expected {expected_version!r}, got {version!r}")

    total_edits = data.get("total_edits")
    if type(total_edits) is not int or total_edits < 0:
        raise TypeError(f"total_edits must be a non-negative integer, got {type(total_edits).__name__}: {total_edits!r}")

    records = data.get("edits")
    if not isinstance(records, list):
        raise TypeError(f"'edits' must be a list of records, got {type(records).__name__}")

    if total_edits != len(records):
        raise ValueError(f"total_edits declared ({total_edits}) does not match edits length ({len(records)})")

    return Catalog.from_dict_list(records, catalog_version=expected_version)
