"""
Lolixco Recommendation Engine HTTP API (v1).

Provides lightweight, deterministic recommendation endpoints powered by the
Stage 1 RecommendationEngine and validated Catalog snapshot.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
import uuid

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from .catalog import Catalog, load_catalog_from_json
from .engine import RecommendationEngine
from .types import (
    CANONICAL_CATEGORIES,
    RecommendationRequest as EngineRequest,
    WatchHistoryEntry as EngineHistoryEntry,
    validate_rfc3339_timestamp,
)

logger = logging.getLogger("lolixco.recsys")
DEFAULT_SNAPSHOT_PATH = Path(__file__).parent / "catalog_snapshot.json"
MAX_REQUEST_BODY_BYTES = 65_536  # 64 KB maximum request body size


# ---------------------------------------------------------------------------
# Pydantic v2 Request & Response DTOs
# ---------------------------------------------------------------------------

class StrictBaseModel(BaseModel):
    """Base model that forbids unknown fields and enforces strict validation."""

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
    )


class WatchHistoryEntryModel(StrictBaseModel):
    """Client session watch event context."""

    edit_id: StrictInt = Field(..., ge=0, description="Non-negative edit ID")
    unique_watch_ms: StrictInt = Field(..., ge=0, le=3600000, description="Non-negative watch time in milliseconds (max 1 hour)")
    occurred_at: str = Field(..., max_length=35, description="Strict RFC3339 UTC timestamp")

    @field_validator("occurred_at")
    @classmethod
    def validate_occurred_at(cls, v: str) -> str:
        return validate_rfc3339_timestamp(v)


class FiltersModel(StrictBaseModel):
    """Optional candidate filters."""

    category: Optional[str] = Field(None, description="Canonical category filter")
    tags_all: List[str] = Field(default_factory=list, max_length=10, description="Optional required tags")

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v_clean = v.strip()
        if not v_clean:
            raise ValueError("category cannot be empty string")
        canonical_map = {c.lower(): c for c in CANONICAL_CATEGORIES}
        if v_clean.lower() not in canonical_map:
            raise ValueError(
                f"Invalid category {v!r}. Must be one of canonical categories: {CANONICAL_CATEGORIES}"
            )
        return canonical_map[v_clean.lower()]

    @field_validator("tags_all")
    @classmethod
    def validate_tags_all(cls, v: List[str]) -> List[str]:
        cleaned = []
        seen = set()
        for t in v:
            if not isinstance(t, str):
                raise ValueError("Each tag must be a string")
            norm = t.strip().lower()
            if not norm:
                raise ValueError("Tags cannot be empty or blank")
            if len(norm) > 64:
                raise ValueError("Tags must be at most 64 characters")
            if norm not in seen:
                seen.add(norm)
                cleaned.append(norm)
        return cleaned


class ContextModel(StrictBaseModel):
    """Session context for in-session recommendations."""

    history: List[WatchHistoryEntryModel] = Field(default_factory=list, max_length=50)


class RecommendationRequestModel(StrictBaseModel):
    """Request model for /api/v1/recommendations."""

    surface: Literal["home", "up_next"] = Field(..., description="Target recommendation surface")
    current_edit_id: Optional[StrictInt] = Field(None, ge=0, description="Active edit ID (required for up_next)")
    limit: StrictInt = Field(12, ge=1, le=50, description="Maximum items to return")
    mode: Literal["auto", "baseline", "neural"] = Field("auto", description="Recommendation mode")
    filters: Optional[FiltersModel] = Field(default_factory=FiltersModel)
    exclude_edit_ids: List[StrictInt] = Field(default_factory=list, max_length=200)
    context: Optional[ContextModel] = Field(default_factory=ContextModel)

    @field_validator("exclude_edit_ids")
    @classmethod
    def validate_exclude_edit_ids(cls, v: List[StrictInt]) -> List[StrictInt]:
        for eid in v:
            if eid < 0:
                raise ValueError(f"Excluded edit ID must be non-negative, got {eid}")
        return v


class EditItemPayload(StrictBaseModel):
    """Canonical edit item metadata matching frontend Edit contract."""

    id: int
    title: str
    category: str
    tags: List[str]
    description: str
    creator: str
    poster: str
    source: str
    duration: str
    trending: bool
    format: Optional[Literal["video", "short"]] = "video"
    fandomIds: Optional[List[str]] = None
    sourceType: Optional[Literal["local_demo", "youtube_embed", "licensed_local_media"]] = "local_demo"
    youtubeVideoId: Optional[str] = None
    channelTitle: Optional[str] = None
    channelId: Optional[str] = None
    sourceUrl: Optional[str] = None


class RecommendedItemModel(StrictBaseModel):
    """Ranked item with score and reason codes."""

    rank: int
    edit_id: int
    score: float
    reason_codes: List[str]
    edit: EditItemPayload


class RecommendationDiagnostics(StrictBaseModel):
    """Execution diagnostics and warnings."""

    warnings: List[str] = Field(default_factory=list)
    fallback_reason: Optional[str] = None


class RecommendationResponseModel(StrictBaseModel):
    """Enveloped response matching the v1 recommendation contract."""

    schema_version: str = "1.0"
    request_id: str
    surface: str
    mode_used: str
    catalog_version: str
    policy_version: str
    as_of: str
    items: List[RecommendedItemModel]
    total_eligible: int
    has_more: bool = False
    next_cursor: Optional[str] = None
    diagnostics: RecommendationDiagnostics


# ---------------------------------------------------------------------------
# FastAPI Application Factory
# ---------------------------------------------------------------------------

def create_app(
    catalog: Optional[Catalog] = None,
    catalog_path: Optional[Path | str] = None,
) -> FastAPI:
    """Create and configure the FastAPI recommendation service."""

    app_state: Dict[str, Any] = {
        "catalog": catalog,
        "engine": None,
        "catalog_error": None,
        "catalog_path": Path(catalog_path or os.getenv("LOLIXCO_CATALOG_PATH") or DEFAULT_SNAPSHOT_PATH),
    }

    # Initialize catalog if not already provided
    if app_state["catalog"] is not None:
        try:
            app_state["engine"] = RecommendationEngine(app_state["catalog"])
        except Exception as e:
            app_state["catalog_error"] = str(e)
    else:
        try:
            loaded_cat = load_catalog_from_json(app_state["catalog_path"])
            app_state["catalog"] = loaded_cat
            app_state["engine"] = RecommendationEngine(loaded_cat)
        except Exception as e:
            app_state["catalog_error"] = str(e)

    app = FastAPI(
        title="Lolixco Recommendation Service",
        version="0.1.0",
        description="Deterministic recommendation engine API for Lolixco",
        docs_url="/docs",
        redoc_url=None,
    )

    # Attach state
    app.state.recsys = app_state

    # Configure CORS
    allowed_origins_env = os.getenv("LOLIXCO_ALLOWED_ORIGINS", "")
    if allowed_origins_env:
        origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
    else:
        origins = [
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:4173",
            "http://localhost:4173",
        ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def limit_request_body_size(request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                length = int(content_length)
                if length > MAX_REQUEST_BODY_BYTES:
                    return JSONResponse(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        content={"detail": f"Request body too large. Maximum permitted size is {MAX_REQUEST_BODY_BYTES} bytes."},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": "Invalid Content-Length header"},
                )

        if request.method in ("POST", "PUT", "PATCH"):
            chunks = []
            total_bytes = 0
            async for chunk in request.stream():
                total_bytes += len(chunk)
                if total_bytes > MAX_REQUEST_BODY_BYTES:
                    return JSONResponse(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        content={"detail": f"Request body too large. Maximum permitted size is {MAX_REQUEST_BODY_BYTES} bytes."},
                    )
                chunks.append(chunk)

            full_body = b"".join(chunks)
            request._body = full_body

            async def receive() -> dict:
                return {"type": "http.request", "body": full_body, "more_body": False}

            request._receive = receive

        return await call_next(request)

    # Clean exception handlers to avoid leaking internals or stack traces
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = []
        for err in exc.errors():
            loc = " -> ".join(str(l) for l in err.get("loc", []))
            msg = err.get("msg", "Validation error")
            errors.append(f"{loc}: {msg}" if loc else msg)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "detail": "Request validation failed",
                "errors": errors,
            },
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": str(exc.detail)},
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        # Never leak traceback or filesystem paths to client
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An internal error occurred processing recommendations."},
        )

    # -----------------------------------------------------------------------
    # Endpoints
    # -----------------------------------------------------------------------

    @app.get("/api/v1/health")
    async def health() -> Dict[str, Any]:
        """Process liveness probe."""
        return {
            "status": "ok",
            "service": "lolixco-recsys",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    @app.get("/api/v1/ready")
    async def ready() -> Dict[str, Any]:
        """Readiness check. Validates that the catalog and engine are active."""
        if app_state["engine"] is None or app_state["catalog"] is None:
            logger.error(
                "Readiness probe failed: Catalog initialization error: %s",
                app_state.get("catalog_error", "unknown"),
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Recommendation engine not ready: catalog initialization failed",
            )
        return {
            "status": "ready",
            "catalog_version": app_state["catalog"].catalog_version,
            "policy_version": app_state["engine"].policy_version,
            "total_edits": len(app_state["catalog"]),
        }

    @app.post("/api/v1/recommendations", response_model=RecommendationResponseModel)
    async def get_recommendations(req: RecommendationRequestModel) -> RecommendationResponseModel:
        """Generate recommendations for home or up_next surfaces."""
        engine: Optional[RecommendationEngine] = app_state["engine"]
        catalog: Optional[Catalog] = app_state["catalog"]

        if engine is None or catalog is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Recommendation engine not ready",
            )

        # Surface-specific validation
        if req.surface == "up_next":
            if req.current_edit_id is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="current_edit_id is required when surface is 'up_next'",
                )
            if req.current_edit_id not in catalog:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"current_edit_id {req.current_edit_id} not found in catalog",
                )

        # Mode validation
        if req.mode == "neural":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Neural recommendation mode is not available in Stage 1 baseline",
            )

        # Build engine history entries
        engine_history: List[EngineHistoryEntry] = []
        if req.context and req.context.history:
            for h in req.context.history:
                engine_history.append(
                    EngineHistoryEntry(
                        edit_id=h.edit_id,
                        unique_watch_ms=h.unique_watch_ms,
                        occurred_at=h.occurred_at,
                    )
                )

        category_filter = None
        required_tags = ()
        if req.filters:
            if req.filters.category:
                category_filter = req.filters.category
            if req.filters.tags_all:
                required_tags = tuple(req.filters.tags_all)

        # Build engine request
        try:
            engine_req = EngineRequest(
                surface=req.surface,
                current_edit_id=req.current_edit_id,
                limit=req.limit,
                exclude_edit_ids=tuple(req.exclude_edit_ids),
                history=tuple(engine_history),
                category_filter=category_filter,
                required_tags=required_tags,
            )
            response = engine.recommend(engine_req)
        except KeyError as ke:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ke))
        except (ValueError, TypeError) as ve:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(ve))

        # Format items for response
        response_items: List[RecommendedItemModel] = []
        for item in response.items:
            response_items.append(
                RecommendedItemModel(
                    rank=item.rank,
                    edit_id=item.edit.id,
                    score=round(item.score, 4),
                    reason_codes=list(item.reason_codes),
                    edit=EditItemPayload(
                        id=item.edit.id,
                        title=item.edit.title,
                        category=item.edit.category,
                        tags=list(item.edit.tags),
                        description=item.edit.description,
                        creator=item.edit.creator,
                        poster=item.edit.poster,
                        source=item.edit.source,
                        duration=item.edit.duration,
                        trending=item.edit.trending,
                        format=item.edit.format,
                        fandomIds=list(item.edit.fandom_ids) if item.edit.fandom_ids else None,
                        sourceType=item.edit.source_type,
                        youtubeVideoId=item.edit.youtube_video_id if item.edit.youtube_video_id else None,
                        channelTitle=item.edit.channel_title,
                        channelId=item.edit.channel_id,
                        sourceUrl=item.edit.source_url,
                    ),
                )
            )

        as_of_time = datetime.now(timezone.utc).isoformat()
        request_id = f"req_{uuid.uuid4().hex[:12]}"

        return RecommendationResponseModel(
            schema_version="1.0",
            request_id=request_id,
            surface=req.surface,
            mode_used=response.mode_used,
            catalog_version=response.catalog_version,
            policy_version=response.policy_version,
            as_of=as_of_time,
            items=response_items,
            total_eligible=response.total_eligible,
            has_more=False,
            next_cursor=None,
            diagnostics=RecommendationDiagnostics(
                warnings=list(response.diagnostics.get("warnings", [])),
                fallback_reason=response.diagnostics.get("fallback_reason"),
            ),
        )

    return app


# Default app instance for ASGI servers (e.g. uvicorn server.recsys.api:app)
app = create_app()

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("LOLIXCO_API_HOST", "127.0.0.1")
    port = int(os.getenv("LOLIXCO_API_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
