"""Run one explicitly approved public-video request in a disposable subprocess."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "edit-dna"))
from youtube_analysis import ProviderError, analyze_youtube


def emit(kind, **data):
    print(json.dumps({"kind": kind, **data}, allow_nan=False), flush=True)


def main(video_id):
    emit("stage", stage="Running Gemini audiovisual analysis", progress=20)
    try:
        v6, presentation = analyze_youtube(video_id)
    except ProviderError as error:
        emit("error", message=error.message, code=error.status)
        return 1
    emit("stage", stage="Preparing results", progress=90)
    for section in presentation["assessment_sections"]:
        observed = section.get("evidence_status") == "EVALUATED_SEMANTIC_EXPERIMENTAL"
        emit(
            "event", event_type="SECTION_COMPLETED" if observed else "SECTION_UNASSESSED",
            section_id=section["section_id"], payload=section, duration_ms=0, stage="Preparing results", progress=92,
        )
    Path("result.json").write_text(json.dumps({"v6": v6, "presentation": presentation}, allow_nan=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
