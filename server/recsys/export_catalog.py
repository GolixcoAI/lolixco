import argparse
import json
from pathlib import Path
import subprocess
import sys
import os
import tempfile
from typing import Any, Dict, List, Tuple


def get_repo_root() -> Path:
    """Find repository root by walking up from this file's location."""
    current = Path(__file__).resolve().parent
    for parent in [current] + list(current.parents):
        if (parent / "package.json").is_file() and (parent / "src" / "data" / "edits.ts").is_file():
            return parent
    return Path.cwd()


def fetch_edits_from_source(repo_root: Path) -> List[Dict[str, Any]]:
    """
    Execute Node with the repository's native TypeScript loader
    to extract the authoritative edits array directly from src/data/edits.ts.
    Avoids brittle regex parsing and guarantees 100% property fidelity.
    """
    edits_ts = repo_root / "src" / "data" / "edits.ts"
    loader_mjs = repo_root / "tests" / "register-ts.mjs"

    if not edits_ts.is_file():
        raise FileNotFoundError(f"Missing edits source file: {edits_ts}")
    if not loader_mjs.is_file():
        raise FileNotFoundError(f"Missing Node TypeScript loader: {loader_mjs}")

    rel_loader = loader_mjs.relative_to(repo_root)
    node_cmd = [
        "node",
        "--import",
        f"./{rel_loader}",
        "-e",
        'import { edits } from "./src/data/edits.ts"; console.log(JSON.stringify(edits));',
    ]

    try:
        proc = subprocess.run(
            node_cmd,
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=True,
        )
        data = json.loads(proc.stdout)
        if not isinstance(data, list):
            raise ValueError(f"Expected list of edits from Node, got {type(data)}")
        return data
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"Node execution failed with exit code {e.returncode}: {e.stderr}"
        ) from e
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to decode Node JSON output: {e}") from e


def generate_snapshot_payload(edits: List[Dict[str, Any]], version: str = "demo-catalog-v1") -> Dict[str, Any]:
    """Wrap edits in a versioned snapshot envelope."""
    from .catalog import Catalog
    Catalog.from_dict_list(edits)
    return {
        "catalog_version": version,
        "total_edits": len(edits),
        "edits": edits,
    }


def sync_catalog(repo_root: Path, output_file: Path) -> Dict[str, Any]:
    """Fetch live edits from TypeScript source and write snapshot JSON."""
    target = output_file.resolve()
    protected_root = get_repo_root()
    if (target == (protected_root / "server/recsys/catalog_snapshot.json").resolve()
            or target.is_relative_to((protected_root / "src/data").resolve())
            or target.is_relative_to((protected_root / "content").resolve())):
        raise ValueError("Independent production snapshot writes are retired; use scripts/compile-catalog.mjs for paired publication")
    if output_file.suffix != ".json":
        raise ValueError("Fixture snapshot exports require a JSON output path")
    edits = fetch_edits_from_source(repo_root)
    payload = generate_snapshot_payload(edits)

    output_file.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output_file.parent, delete=False) as f:
            temp_path = Path(f.name)
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        # Replace a directory entry instead of truncating possible hard-link aliases.
        os.replace(temp_path, output_file)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

    return payload


ALLOWED_ENVELOPE_KEYS = {"catalog_version", "total_edits", "edits", "exported_at"}
REQUIRED_ENVELOPE_KEYS = {"catalog_version", "total_edits", "edits"}

ALLOWED_RECORD_FIELDS = {
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
REQUIRED_RECORD_FIELDS = {
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


def check_catalog_drift(
    repo_root: Path, snapshot_path: Path, expected_version: str = "demo-catalog-v1"
) -> Tuple[bool, List[str]]:
    """
    Compare snapshot file against active TypeScript source.
    Validates:
    - File existence and valid JSON.
    - Envelope keys and catalog_version.
    - Consistency of total_edits with actual records count.
    - Count match with active live TypeScript source.
    - Canonical record schema (unexpected fields, missing fields, type correctness).
    - Exact property values between live source and snapshot.
    Returns (is_synced, diff_reasons).
    """
    if not snapshot_path.is_file():
        return False, [f"Snapshot file not found: {snapshot_path}"]

    with snapshot_path.open("r", encoding="utf-8") as f:
        try:
            snapshot_data = json.load(f)
        except Exception as e:
            return False, [f"Corrupt snapshot JSON: {e}"]

    diffs: List[str] = []

    if not isinstance(snapshot_data, dict):
        return False, [f"Snapshot root must be JSON object, got {type(snapshot_data).__name__}"]

    # 1. Envelope validation
    extra_env_keys = set(snapshot_data.keys()) - ALLOWED_ENVELOPE_KEYS
    if extra_env_keys:
        diffs.append(f"Unexpected snapshot envelope keys: {sorted(extra_env_keys)}")

    missing_env_keys = REQUIRED_ENVELOPE_KEYS - set(snapshot_data.keys())
    if missing_env_keys:
        diffs.append(f"Missing required snapshot envelope keys: {sorted(missing_env_keys)}")

    cat_version = snapshot_data.get("catalog_version")
    if cat_version != expected_version:
        diffs.append(
            f"Catalog version mismatch: expected {expected_version!r}, got {cat_version!r}"
        )

    snapshot_edits = snapshot_data.get("edits")
    if not isinstance(snapshot_edits, list):
        diffs.append(f"Snapshot missing valid 'edits' list, got {type(snapshot_edits).__name__}")
        return False, diffs

    # Same runtime shapes as serving: an allowlisted name alone is insufficient.
    try:
        from .catalog import Catalog
        Catalog.from_dict_list(snapshot_edits)
    except (TypeError, ValueError) as error:
        diffs.append(f"Snapshot record validation failed: {error}")

    total_edits_declared = snapshot_data.get("total_edits")
    if type(total_edits_declared) is not int or total_edits_declared < 0:
        diffs.append(
            f"Snapshot 'total_edits' must be strict integer, got {type(total_edits_declared).__name__}: {total_edits_declared!r}"
        )
    elif total_edits_declared != len(snapshot_edits):
        diffs.append(
            f"Snapshot internal count mismatch: total_edits declared {total_edits_declared} != edits length {len(snapshot_edits)}"
        )

    # 2. Live source comparison
    try:
        live_edits = fetch_edits_from_source(repo_root)
        from .catalog import Catalog
        Catalog.from_dict_list(live_edits)
    except Exception as e:
        return False, [f"Failed to fetch live edits: {e}"]

    if len(live_edits) != len(snapshot_edits):
        diffs.append(
            f"Count mismatch: live has {len(live_edits)} edits, snapshot has {len(snapshot_edits)}"
        )

    if total_edits_declared != len(live_edits):
        diffs.append(
            f"Live count vs snapshot declared count mismatch: live {len(live_edits)} vs total_edits {total_edits_declared}"
        )

    # 3. Schema & property-level validation
    snap_by_id = {}
    for idx, e in enumerate(snapshot_edits):
        if not isinstance(e, dict):
            diffs.append(f"Snapshot record at index {idx} is not a dictionary: {type(e).__name__}")
            continue

        raw_id = e.get("id")
        if type(raw_id) is not int or raw_id < 0:
            diffs.append(f"Snapshot record at index {idx} has invalid ID: {raw_id!r}")
            continue

        extra_record_keys = set(e.keys()) - ALLOWED_RECORD_FIELDS
        if extra_record_keys:
            diffs.append(f"Snapshot edit {raw_id} has unexpected extra fields: {sorted(extra_record_keys)}")

        missing_record_keys = REQUIRED_RECORD_FIELDS - set(e.keys())
        if missing_record_keys:
            diffs.append(f"Snapshot edit {raw_id} missing required fields: {sorted(missing_record_keys)}")

        snap_by_id[raw_id] = e

    live_by_id = {e.get("id"): e for e in live_edits if isinstance(e, dict)}

    missing_in_snap = set(live_by_id.keys()) - set(snap_by_id.keys())
    missing_in_live = set(snap_by_id.keys()) - set(live_by_id.keys())

    if missing_in_snap:
        diffs.append(f"IDs in live but missing in snapshot: {sorted(missing_in_snap)}")
    if missing_in_live:
        diffs.append(f"IDs in snapshot but missing in live: {sorted(missing_in_live)}")

    # Exact field-level equality and type check
    for item_id, live_item in live_by_id.items():
        if item_id in snap_by_id:
            snap_item = snap_by_id[item_id]
            for field in [
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
            ]:
                live_val = live_item.get(field)
                snap_val = snap_item.get(field)
                if live_val is None and snap_val is None:
                    continue
                if type(live_val) is not type(snap_val):
                    diffs.append(
                        f"Item {item_id} field '{field}' type drifted: live type={type(live_val).__name__} vs snapshot type={type(snap_val).__name__} ({live_val!r} vs {snap_val!r})"
                    )
                elif live_val != snap_val:
                    diffs.append(
                        f"Item {item_id} field '{field}' drifted: live={live_val!r} vs snapshot={snap_val!r}"
                    )

    return (len(diffs) == 0), diffs


def main() -> None:
    parser = argparse.ArgumentParser(description="Synchronize and drift-check recsys catalog.")
    parser.add_argument("--check", action="store_true", help="Check for drift without modifying snapshot")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Path to snapshot file (default: server/recsys/catalog_snapshot.json)",
    )
    args = parser.parse_args()

    repo_root = get_repo_root()
    snapshot_path = (
        args.output
        if args.output
        else repo_root / "server" / "recsys" / "catalog_snapshot.json"
    )

    if args.check:
        synced, diffs = check_catalog_drift(repo_root, snapshot_path)
        if synced:
            print("OK: Catalog snapshot matches src/data/edits.ts with 0 drift.")
            sys.exit(0)
        else:
            print("ERROR: Catalog drift detected between src/data/edits.ts and snapshot:")
            for d in diffs:
                print(f"  - {d}")
            sys.exit(1)
    else:
        sync_catalog(repo_root, snapshot_path)
        print(f"Catalog synced successfully to {snapshot_path}")


if __name__ == "__main__":
    main()
