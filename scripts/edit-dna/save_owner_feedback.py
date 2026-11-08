import os
import json

annot_dir = os.path.expanduser("~/.lolixco-edit-dna/annotations")
os.makedirs(annot_dir, exist_ok=True)
feedback_file = os.path.join(annot_dir, "owner_feedback_dhurandhar.json")

feedback = {
    "media_filename": "Best Dhurandhar edit . mp4",
    "date": "2026-11-04",
    "evaluator": "Owner (Experienced Video Editor)",
    "owner_rating_range": [7.0, 8.0],
    "owner_rating_midpoint": 7.5,
    "owner_judgment": "Strong editing with high rhythmic synchronization quality.",
    "evaluation_notes": (
        "The owner evaluated this edit as one of the stronger rhythmic edits in the collection, "
        "judging beat sync at 7-8/10. The editing relies heavily on syncopated cuts, trailer percussion "
        "impacts, and visual flash pulses on beats rather than naive quarter-note downbeats."
    ),
    "discrepancy_diagnosis": {
        "algorithm_score": 4.21,
        "formula_evaluation": (
            "Rigid quarter-note grid only (112.3 BPM) calculated 34.8% tight sync + "
            "0.5 * 14.5% loose sync = 42.05% -> 4.21/10."
        ),
        "root_cause": (
            "The naive formula penalized cuts that land on 16th-note subdivisions and offbeat "
            "acoustic transients as large timing errors (230-265ms offset), when in reality they are "
            "locked to syncopated musical accents. It also ignored 22/40 intra-shot flashes that hit audio transients."
        ),
        "measured_multi_grid_facts": {
            "primary_bpm": 112.3,
            "primary_grid_tight_percent": 34.8,
            "double_time_grid_tight_percent": 68.1,
            "subdivision_16th_grid_tight_percent": 100.0,
            "audio_onset_transient_tight_percent": 56.5,
            "audio_onset_transient_loose_percent": 65.2,
            "flash_frame_onset_sync_percent": 55.0,
            "compound_rhythmic_sync_percent": 78.3
        }
    },
    "annotated_timestamps": [
        {"timestamp_sec": 1.13, "tag": "onset_hit", "delta_ms": 18.4, "notes": "Snare transient hit; primary grid missed by 237ms but onset delta is 18.4ms."},
        {"timestamp_sec": 5.20, "tag": "downbeat_lock", "delta_ms": 1.3, "notes": "Perfect downbeat cut locked to primary tempo (1.3ms delta)."},
        {"timestamp_sec": 7.10, "tag": "syncopated_impact", "delta_ms": 28.5, "notes": "Offbeat trailer impact cut (28.5ms from audio onset, 16.9ms from 16th subdivision)."},
        {"timestamp_sec": 12.03, "tag": "bass_drop_hit", "delta_ms": 5.1, "notes": "Sub-bass impact cut (5.1ms from audio onset, 260ms from primary downbeat)."},
        {"timestamp_sec": 12.57, "tag": "kinetic_transient", "delta_ms": 5.0, "notes": "Rapid kinetic follow-through cut (5.0ms from audio onset)."}
    ],
    "governance": {
        "privacy_status": "PRIVATE_LOCAL_ONLY_UNTRACKED",
        "retention": "Stored in ~/.lolixco-edit-dna/annotations/ on local host disk. Never committed to git."
    }
}

with open(feedback_file, "w", encoding="utf-8") as f:
    json.dump(feedback, f, indent=2)

print(f"Saved owner feedback to {feedback_file}")

