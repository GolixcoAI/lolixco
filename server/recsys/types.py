from dataclasses import dataclass, field
from datetime import datetime
import re
from typing import Any, Optional, Sequence, Tuple


RFC3339_REGEX = re.compile(
    r"^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,9})?([Zz]|[+-][0-9]{2}:[0-9]{2})$"
)


def validate_rfc3339_timestamp(val: str) -> str:
    """Validate that val is a strict RFC3339 UTC/offset timestamp.

    Rejects:
    - Non-string or empty strings.
    - Surrounding whitespace (leading or trailing whitespace is rejected, not normalized).
    - Strings exceeding 35 characters (preventing DoS and unbounded error reflection).
    - ISO week dates (e.g. 2026-W42-6T12:34:56+00:00).
    - Space separators (e.g. 2026-10-17 12:34:56+00:00).
    - Naive timestamps without timezone offset.
    - Invalid calendar dates (e.g. 2026-02-31T12:00:00Z).
    """
    if type(val) is not str:
        raise TypeError(f"Timestamp must be string, got {type(val).__name__}")
    if not val:
        raise ValueError("Timestamp cannot be empty")
    if val != val.strip():
        raise ValueError("Timestamp cannot contain leading or trailing whitespace")
    if len(val) > 35:
        raise ValueError("Timestamp exceeds maximum permitted length of 35 characters")

    match = RFC3339_REGEX.match(val)
    if not match:
        raise ValueError(
            "Timestamp must follow strict RFC3339 format with explicit timezone (e.g. '2026-10-17T12:00:00Z' or '2026-10-17T12:00:00+00:00')"
        )

    # Check calendar and time validity
    iso_str = val.replace("Z", "+00:00").replace("z", "+00:00")
    try:
        dt = datetime.fromisoformat(iso_str)
        if dt.tzinfo is None:
            raise ValueError("Timestamp must include an explicit timezone offset")
    except Exception as e:
        raise ValueError(f"Invalid RFC3339 calendar date or time: {e}") from e

    return val


@dataclass(frozen=True)
class EditItem:
    """Canonical representation of an edit in the recommendation engine with strict schema validation."""

    id: int
    title: str
    category: str
    tags: tuple[str, ...]
    description: str
    creator: str
    poster: str
    source: str
    duration: str  # e.g. "0:12"
    duration_ms: int  # e.g. 12000
    duration_sec: float  # e.g. 12.0
    trending: bool = False
    format: str = "video"
    fandom_ids: tuple[str, ...] = ()
    source_type: str = "local_demo"
    youtube_video_id: str = ""
    channel_title: Optional[str] = None
    channel_id: Optional[str] = None
    source_url: Optional[str] = None

    def __post_init__(self) -> None:
        # Strict integer check: Python booleans are subclasses of int, so reject bool explicitly
        if type(self.id) is not int or self.id < 0:
            raise TypeError(f"Edit id must be strict non-negative integer, got {type(self.id).__name__}: {self.id!r}")

        if type(self.title) is not str or not self.title.strip():
            raise TypeError(f"Edit title must be non-empty string, got {type(self.title).__name__}: {self.title!r}")

        if type(self.category) is not str or not self.category.strip():
            raise TypeError(f"Edit category must be non-empty string, got {type(self.category).__name__}: {self.category!r}")

        if not isinstance(self.tags, (tuple, list)) or isinstance(self.tags, (str, bytes)):
            raise TypeError(f"Edit tags must be sequence of strings, got {type(self.tags).__name__}: {self.tags!r}")

        for t in self.tags:
            if type(t) is not str or not t.strip():
                raise TypeError(f"Each tag must be non-empty string, got {type(t).__name__}: {t!r}")

        if type(self.description) is not str:
            raise TypeError(f"Edit description must be string, got {type(self.description).__name__}")

        if type(self.creator) is not str or not self.creator.strip():
            raise TypeError(f"Edit creator must be non-empty string, got {type(self.creator).__name__}: {self.creator!r}")

        if type(self.poster) is not str or not self.poster.strip():
            raise TypeError(f"Edit poster must be non-empty string, got {type(self.poster).__name__}: {self.poster!r}")

        if type(self.source) is not str or not self.source.strip():
            raise TypeError(f"Edit source must be non-empty string, got {type(self.source).__name__}: {self.source!r}")

        if type(self.duration) is not str or not self.duration.strip():
            raise TypeError(f"Edit duration must be non-empty string, got {type(self.duration).__name__}: {self.duration!r}")

        if type(self.duration_ms) is not int or self.duration_ms <= 0:
            raise TypeError(f"duration_ms must be positive integer, got {type(self.duration_ms).__name__}: {self.duration_ms!r}")

        if (not isinstance(self.duration_sec, (int, float))) or isinstance(self.duration_sec, bool) or self.duration_sec <= 0:
            raise TypeError(f"duration_sec must be positive float/int, got {type(self.duration_sec).__name__}: {self.duration_sec!r}")

        if type(self.trending) is not bool:
            raise TypeError(f"trending must be boolean, got {type(self.trending).__name__}: {self.trending!r}")

        if type(self.format) is not str or self.format not in ("video", "short"):
            raise ValueError(f"format must be 'video' or 'short', got {self.format!r}")

        if not isinstance(self.fandom_ids, (tuple, list)) or isinstance(self.fandom_ids, (str, bytes)):
            raise TypeError(f"fandom_ids must be sequence of strings, got {type(self.fandom_ids).__name__}: {self.fandom_ids!r}")

        for fid in self.fandom_ids:
            if type(fid) is not str or not fid.strip():
                raise TypeError(f"Each fandom_id must be non-empty string, got {fid!r}")

        if type(self.source_type) is not str or self.source_type not in ("local_demo", "youtube_embed", "licensed_local_media"):
            raise ValueError(f"source_type must be 'local_demo', 'youtube_embed', or 'licensed_local_media', got {self.source_type!r}")

        if type(self.youtube_video_id) is not str:
            raise TypeError(f"youtube_video_id must be string, got {type(self.youtube_video_id).__name__}")

        for name in ("channel_title", "channel_id", "source_url"):
            value = getattr(self, name)
            if value is not None and (type(value) is not str or not value.strip()):
                raise TypeError(f"{name} must be a non-empty string when present")
        if any(getattr(self, name) is not None for name in ("channel_title", "channel_id", "source_url")) and self.source_type != "youtube_embed":
            raise ValueError("YouTube channel metadata requires youtube_embed source")
        if any(getattr(self, name) is not None for name in ("channel_title", "channel_id", "source_url")) and not re.fullmatch(r"[A-Za-z0-9_-]{11}", self.youtube_video_id):
            raise ValueError("YouTube channel metadata requires a valid video identity")
        if self.source_url is not None and self.source_url not in (
            f"https://www.youtube.com/watch?v={self.youtube_video_id}",
            f"https://youtube.com/watch?v={self.youtube_video_id}",
        ):
            raise ValueError("source_url must be a canonical watch URL matching youtube_video_id")


@dataclass(frozen=True)
class WatchHistoryEntry:
    """Client session watch event for in-session recommendation context."""

    edit_id: int
    unique_watch_ms: int
    occurred_at: str  # RFC3339 / ISO 8601 UTC timestamp

    def __post_init__(self) -> None:
        if type(self.edit_id) is not int or self.edit_id < 0:
            raise TypeError(f"edit_id must be strict non-negative integer, got {type(self.edit_id).__name__}: {self.edit_id!r}")
        if type(self.unique_watch_ms) is not int or self.unique_watch_ms < 0:
            raise TypeError(f"unique_watch_ms must be non-negative integer, got {type(self.unique_watch_ms).__name__}: {self.unique_watch_ms!r}")
        if self.unique_watch_ms > 3600000:
            raise ValueError(f"unique_watch_ms exceeds maximum permitted 3600000ms (1hr), got {self.unique_watch_ms}")
        if type(self.occurred_at) is not str:
            raise TypeError(f"occurred_at must be string, got {type(self.occurred_at).__name__}: {self.occurred_at!r}")
        validate_rfc3339_timestamp(self.occurred_at)


CANONICAL_CATEGORIES: tuple[str, ...] = (
    "Cinematic",
    "Gaming",
    "Anime",
    "Movies",
    "Series",
    "Phonk",
    "Multifandom",
)


@dataclass(frozen=True)
class RecommendationRequest:
    """Strictly validated parameters for a recommendation request."""

    surface: str  # "home" or "up_next"
    current_edit_id: Optional[int] = None
    limit: int = 12
    exclude_edit_ids: tuple[int, ...] = ()
    history: tuple[WatchHistoryEntry, ...] = ()
    category_filter: Optional[str] = None
    required_tags: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.surface not in ("home", "up_next"):
            raise ValueError(f"surface must be 'home' or 'up_next', got {self.surface!r}")

        if self.surface == "up_next":
            if self.current_edit_id is None:
                raise ValueError("current_edit_id is required when surface is 'up_next'")
            if type(self.current_edit_id) is not int or self.current_edit_id < 0:
                raise TypeError(f"current_edit_id must be non-negative integer, got {type(self.current_edit_id).__name__}: {self.current_edit_id!r}")
        elif self.surface == "home" and self.current_edit_id is not None:
            if type(self.current_edit_id) is not int or self.current_edit_id < 0:
                raise TypeError(f"current_edit_id must be non-negative integer or None for home, got {type(self.current_edit_id).__name__}: {self.current_edit_id!r}")

        if type(self.limit) is not int or self.limit < 1 or self.limit > 50:
            raise ValueError(f"limit must be integer between 1 and 50, got {type(self.limit).__name__}: {self.limit!r}")

        if not isinstance(self.exclude_edit_ids, (tuple, list)):
            raise TypeError(f"exclude_edit_ids must be a sequence of integers, got {type(self.exclude_edit_ids).__name__}")
        for eid in self.exclude_edit_ids:
            if type(eid) is not int or eid < 0:
                raise TypeError(f"exclude_edit_ids elements must be non-negative integers, got {type(eid).__name__}: {eid!r}")

        if not isinstance(self.history, (tuple, list)):
            raise TypeError(f"history must be a sequence of WatchHistoryEntry, got {type(self.history).__name__}")
        for h in self.history:
            if not isinstance(h, WatchHistoryEntry):
                raise TypeError(f"history elements must be WatchHistoryEntry instances, got {type(h).__name__}: {h!r}")

        if self.category_filter is not None:
            if type(self.category_filter) is not str or not self.category_filter.strip():
                raise TypeError(f"category_filter must be non-empty string or None, got {type(self.category_filter).__name__}: {self.category_filter!r}")
            if self.category_filter not in CANONICAL_CATEGORIES:
                raise ValueError(
                    f"Unknown category_filter {self.category_filter!r}. Must be one of canonical categories: {CANONICAL_CATEGORIES}"
                )

        if not isinstance(self.required_tags, (tuple, list)):
            raise TypeError(f"required_tags must be sequence of strings, got {type(self.required_tags).__name__}")
        if len(self.required_tags) > 10:
            raise ValueError(f"At most 10 required_tags permitted, got {len(self.required_tags)}")
        for t in self.required_tags:
            if type(t) is not str or not t.strip():
                raise TypeError(f"Each required tag must be non-empty string, got {t!r}")
            if len(t.strip()) > 64:
                raise ValueError(f"Tag exceeds maximum length 64 characters: {t!r}")


@dataclass(frozen=True)
class RecommendedItem:
    """Ranked item with score and reason codes."""

    rank: int
    edit: EditItem
    score: float
    reason_codes: tuple[str, ...]


@dataclass(frozen=True)
class RecommendationResponse:
    """Enveloped response from the recommendation engine."""

    surface: str
    mode_used: str  # e.g. "baseline"
    catalog_version: str
    policy_version: str
    items: tuple[RecommendedItem, ...]
    total_eligible: int
    diagnostics: dict = field(default_factory=dict)
