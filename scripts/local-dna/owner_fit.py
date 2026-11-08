"""Private, method-matched preference calibration with held-out baseline checks."""

import argparse
import fcntl
import hashlib
import json
import math
import os
import re
import tempfile
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

METHOD = "studio_owner_preference_v1"
MIN_REVIEWS = 12
REGULARIZATION = 1.0
MAX_REVIEWS = 250
FEATURE_IDS = (
    "beat_synchronization", "cuts_and_transitions", "pacing", "visual_measurements",
)
HUMAN_FEATURES = (
    "beat_synchronization", "transitions", "pacing", "visual_quality",
    "storytelling_emotion", "originality_creativity",
)
HASH = re.compile(r"[a-f0-9]{64}")
SOURCES = [
    "https://scikit-learn.org/stable/common_pitfalls.html",
    "https://scikit-learn.org/stable/modules/cross_validation.html",
    "https://www.jmlr.org/papers/v11/cawley10a.html",
]


def state_directory():
    parent = Path(os.environ.get("LOLIXCO_OWNER_STATE_PARENT") or os.environ.get("LOLIXCO_DNA_STATE_PARENT") or Path.home())
    return parent / ".lolixco-edit-dna"


def valid_score(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 10


def content_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fit_weights(features, targets):
    """A fixed regularized simplex model. No hyperparameter search uses holdouts."""
    x = np.asarray(features, dtype=float)
    y = np.asarray(targets, dtype=float)
    prior = np.full(x.shape[1], 1 / x.shape[1])

    def objective(weights):
        return float(np.mean(np.square(x @ weights - y)) + REGULARIZATION * np.sum(np.square(weights - prior)))

    def gradient(weights):
        return 2 * x.T @ (x @ weights - y) / len(y) + 2 * REGULARIZATION * (weights - prior)

    fit = minimize(objective, prior, jac=gradient, method="SLSQP", bounds=[(0, 1)] * len(prior),
                   constraints={"type": "eq", "fun": lambda weights: np.sum(weights) - 1},
                   options={"maxiter": 150, "ftol": 1e-10})
    if not fit.success or not np.isfinite(fit.x).all():
        raise ValueError("Preference calibration did not converge.")
    return fit.x


def validate_model(features, targets):
    x = np.asarray(features, dtype=float)
    y = np.asarray(targets, dtype=float)
    predicted, medians, means = [], [], []
    for index in range(len(y)):
        training = np.arange(len(y)) != index
        predicted.append(float(x[index] @ fit_weights(x[training], y[training])))
        medians.append(float(np.median(y[training])))
        means.append(float(np.mean(y[training])))
    errors = {
        "model": np.abs(y - predicted),
        "equal_weight": np.abs(y - np.mean(x, axis=1)),
        "training_median": np.abs(y - medians),
        "training_mean": np.abs(y - means),
    }
    metrics = {name + "_mae": round(float(np.mean(values)), 4) for name, values in errors.items()}
    metrics.update(
        n_reviews=len(y), validation="leave_one_content_out", fixed_regularization=REGULARIZATION,
        model_wins_vs_equal_weight=int(np.sum(errors["model"] < errors["equal_weight"])),
        model_wins_vs_training_median=int(np.sum(errors["model"] < errors["training_median"])),
    )
    best_baseline = min(float(np.mean(errors[key])) for key in ("equal_weight", "training_median", "training_mean"))
    improvement = best_baseline - float(np.mean(errors["model"]))
    metrics["baseline_improvement_mae"] = round(improvement, 4)
    # This is a conservative operating policy, not a statistical confidence claim.
    metrics["passes_baselines"] = improvement >= max(.1, best_baseline * .1)
    return metrics


def report_features(report):
    if report.get("schema_version") != "7.0.0-presentation" or report.get("is_synthetic_fixture") is True:
        raise ValueError("Feedback needs a genuine local Studio presentation report.")
    identity = report.get("context_evidence", {}).get("local_input_sha256")
    if not isinstance(identity, str) or not HASH.fullmatch(identity):
        raise ValueError("This report lacks the local content identifier. Analyze the file again before recording feedback.")
    sections = {section.get("section_id"): section for section in report.get("assessment_sections", [])}
    values, methods = [], []
    for key in FEATURE_IDS:
        section = sections.get(key, {})
        value = section.get("score_0_10")
        method = section.get("method_version", "")
        if not valid_score(value) or not isinstance(method, str) or not method.startswith("phase9_"):
            raise ValueError("Owner-fit learning currently needs all four supported local technical scores.")
        if section.get("evidence_status") not in ("MEASURED_SIGNAL", "EXPERIMENTAL_PROXY"):
            raise ValueError("The feedback feature methods must be local technical measurements.")
        values.append(float(value))
        methods.append(method)
    return identity, methods, values


def feedback_file(directory=None):
    return (Path(directory) if directory is not None else state_directory()) / "studio_owner_feedback.json"


def load_feedback(directory=None):
    path = feedback_file(directory)
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or data.get("schema_version") != 1 or not isinstance(data.get("reviews"), list):
        raise ValueError("The private feedback store has an unsupported format.")
    return data["reviews"]


def record_feedback(report, overall, directory=None):
    if not valid_score(overall):
        raise ValueError("Give an overall preference score between 0 and 10.")
    identity, methods, values = report_features(report)
    path = feedback_file(directory)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    lock_fd = os.open(path.with_suffix(".lock"), os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(lock_fd, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        rows = [row for row in load_feedback(directory) if row.get("content_sha256") != identity]
        rows.append({"content_sha256": identity, "feature_methods": methods, "features": values, "owner_score": float(overall)})
        if len(rows) > MAX_REVIEWS:
            raise ValueError(f"The private preference store supports up to {MAX_REVIEWS} distinct reviews.")
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".owner-feedback-", delete=False) as target:
            temporary = Path(target.name)
            try:
                json.dump({"schema_version": 1, "reviews": rows}, target, allow_nan=False)
                target.flush()
                os.fsync(target.fileno())
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
    return len(rows)


def unassessed(reason, evidence=None):
    return {
        "section_id": "personalized_owner_fit", "score_0_10": None, "evidence_status": "NOT_YET_ASSESSED",
        "method_version": METHOD, "creator_explanation": reason, "timestamps": [],
        "limitations": ["Human-entered rubric scores and machine signal proxies use different measurement methods.",
                        "Small-sample validation cannot establish calibrated confidence or broad taste coverage."],
        "evidence_refs": {
            "assessment_reason": reason,
            "suggestion": "Analyze varied local edits and record independent owner ratings to build comparable feedback.",
            **(evidence or {}),
        },
    }


def assess_owner_fit(report, directory=None):
    try:
        identity, methods, values = report_features(report)
    except ValueError as error:
        return unassessed(str(error))
    try:
        rows = load_feedback(directory)
    except (OSError, ValueError):
        return unassessed("The private owner-feedback store could not be read. Local technical analysis remains available.")
    compatible = {}
    for row in rows:
        features = row.get("features")
        key = row.get("content_sha256")
        if (isinstance(key, str) and HASH.fullmatch(key) and key != identity and row.get("feature_methods") == methods
                and isinstance(features, list) and len(features) == len(FEATURE_IDS)
                and all(valid_score(value) for value in features) and valid_score(row.get("owner_score"))):
            compatible[key] = row
    cohort = list(compatible.values())
    available = {"compatible_reviews": len(cohort), "minimum_reviews_policy": MIN_REVIEWS,
                 "model_inputs": "Four technical signals with identical extraction methods"}
    if len(cohort) < MIN_REVIEWS:
        return unassessed(
            f"Owner fit needs at least {MIN_REVIEWS} distinct reviews paired with these Studio measurement methods. "
            f"{len(cohort)} compatible reviews are available after excluding this edit. Existing human rubric reviews need method-matched measurements.",
            available,
        )
    x = np.array([row["features"] for row in cohort])
    y = np.array([row["owner_score"] for row in cohort])
    try:
        validation = validate_model(x, y)
        available["validation"] = validation
        if not validation["passes_baselines"]:
            return unassessed("Personalization did not improve held-out prediction enough over equal weighting and constant baselines.", available)
        if np.any(np.asarray(values) < np.min(x, axis=0) - .25) or np.any(np.asarray(values) > np.max(x, axis=0) + .25):
            return unassessed("This edit's signal values extend beyond the reviewed range. Owner fit needs more comparable feedback.", available)
        prediction = float(np.asarray(values) @ fit_weights(x, y))
    except (ValueError, ArithmeticError, np.linalg.LinAlgError):
        return unassessed("The preference model could not be validated for this edit.", available)
    return {
        **unassessed("", available), "score_0_10": round(max(0, min(10, prediction)), 2),
        "evidence_status": "PERSONALIZED_ESTIMATE",
        "creator_explanation": "Experimental preference estimate learned from independent owner scores on comparable local measurements. The model passed held-out baseline checks.",
        "limitations": ["This estimate uses technical measurements and covers the reviewed signal range only.",
                        "The validation error describes this small cohort. It is not calibrated confidence or an artistic quality grade."],
    }


def audit_existing_owner_data(directory=None):
    root = Path(directory) if directory is not None else state_directory()
    ratings = json.loads((root / "owner_ratings.json").read_text()).get("ratings", {})
    comparisons = json.loads((root / "owner_comparisons.json").read_text()).get("comparisons", [])
    cohort, aliases = {}, {}
    for storage_id, row in ratings.items():
        if row.get("is_synthetic_benchmark") is True:
            continue
        identity = row.get("youtube_id") or row.get("canonical_id") or row.get("asset_id")
        features = row.get("component_scores", {})
        score = row.get("overall_subjective_score")
        if not identity or not valid_score(score) or not all(valid_score(features.get(key)) for key in HUMAN_FEATURES):
            continue
        cohort[identity] = {"features": [features[key] for key in HUMAN_FEATURES], "target": score}
        for alias in (storage_id, row.get("youtube_id"), row.get("canonical_id"), row.get("asset_id"), row.get("original_url")):
            if alias:
                aliases[alias] = identity
    if len(cohort) < 3:
        raise ValueError("At least three complete reviewed edits are needed for an audit.")
    identities = list(cohort)
    x = np.array([cohort[key]["features"] for key in identities])
    y = np.array([cohort[key]["target"] for key in identities])
    metrics = validate_model(x, y)
    pair_model, pair_uniform, available_pairs = 0, 0, 0
    for pair in comparisons:
        a = aliases.get(pair.get("candidate_a_canonical")) or aliases.get(pair.get("candidate_a"))
        b = aliases.get(pair.get("candidate_b_canonical")) or aliases.get(pair.get("candidate_b"))
        winner = aliases.get(pair.get("chosen_asset"))
        if not winner:
            winner = {"a": a, "b": b}.get(str(pair.get("winner", "")).lower())
        if a not in cohort or b not in cohort or a == b or winner not in (a, b):
            continue
        training = np.array([key not in (a, b) for key in identities])
        if np.sum(training) < 3:
            continue
        weights = fit_weights(x[training], y[training])
        difference = np.asarray(cohort[a]["features"]) - np.asarray(cohort[b]["features"])
        expected_sign = 1 if winner == a else -1
        pair_model += int(float(difference @ weights) * expected_sign > 0)
        pair_uniform += int(float(np.mean(difference)) * expected_sign > 0)
        available_pairs += 1
    return {
        "method_version": METHOD, "human_rubric_validation": metrics,
        "pairwise_validation": {"n_pairs": available_pairs, "training_protocol": "Exclude both comparison endpoints from rating fit",
                                "model_correct": pair_model, "equal_weight_correct": pair_uniform},
        "runtime_compatible_reviews": len(load_feedback(root)),
        "runtime_status": "NOT_YET_ASSESSED",
        "limitation": "The historic cohort contains human component judgments. These features are unavailable for an unseen local file without new independent assessment. Transfer to machine proxies is unsupported.",
        "sources": SOURCES,
    }


def save_private_audit(report, directory=None):
    root = Path(directory) if directory is not None else state_directory()
    destination = root / "owner_evaluations" / "stage15c_owner_fit_audit.json"
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination.parent.chmod(0o700)
    with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as target:
        json.dump(report, target, indent=2, allow_nan=False)
    destination.chmod(0o600)
    return destination


def main():
    parser = argparse.ArgumentParser(description="Keep owner feedback and validation private on this device.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("audit", help="Validate the existing human-rubric cohort and save an aggregate private report.")
    feedback = commands.add_parser("feedback", help="Record or revise an owner's preference on a local Studio report.")
    feedback.add_argument("--report", type=Path, required=True)
    feedback.add_argument("--score", type=float, required=True)
    args = parser.parse_args()
    if args.command == "audit":
        report = audit_existing_owner_data()
        destination = save_private_audit(report)
        print(json.dumps({"audit_path": str(destination), **report}, indent=2))
    else:
        if args.report.stat().st_size > 2_000_000:
            raise ValueError("Choose a report smaller than 2 MB.")
        count = record_feedback(json.loads(args.report.read_text()), args.score)
        print(f"Saved private feedback for one edit. {count} distinct reviewed edits are available.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        raise SystemExit(str(error)) from None
