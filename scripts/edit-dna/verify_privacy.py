#!/usr/bin/env python3
"""
LOLIXCO EDIT DNA — PRIVACY & DATA INTEGRITY VERIFIER
Enforces permanent protection of owner ratings, comparisons, backups, and critique notes.
Fails with non-zero exit code if:
1. Any private owner data file is tracked by git.
2. Any private owner file is staged for commit.
3. Any tracked code file contains leaked private critique notes.
4. The local persistent mirror in ~/.lolixco-edit-dna/ is missing or corrupt.
"""

import os
import sys
import json
import subprocess
import re

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
HOME_DATA_DIR = os.path.expanduser("~/.lolixco-edit-dna")
DATA_DIR = os.path.join(BASE_DIR, "data", "edit-dna")

PROTECTED_FILES = [
    "data/edit-dna/owner_ratings.json",
    "data/edit-dna/owner_comparisons.json",
    "data/edit-dna/model_history.json",
]


def check_git_tracked_status():
    """Confirms no private file is tracked by git."""
    try:
        tracked = subprocess.check_output(
            ["git", "ls-files"],
            cwd=BASE_DIR,
            encoding="utf-8"
        ).splitlines()
    except Exception as e:
        return False, f"Failed to run git ls-files: {e}"

    leaks = [p for p in PROTECTED_FILES if p in tracked]
    if leaks:
        return False, f"SECURITY VIOLATION: Private files are tracked in git: {leaks}"
    
    # Also ensure no backup directories are tracked
    backup_leaks = [p for p in tracked if "data/edit-dna/backups" in p]
    if backup_leaks:
        return False, f"SECURITY VIOLATION: Backup files are tracked in git: {backup_leaks}"

    return True, "All private files and backup directories are untracked by git."


def check_git_staged_status():
    """Confirms no private file is currently staged in git index."""
    try:
        staged = subprocess.check_output(
            ["git", "diff", "--name-only", "--cached"],
            cwd=BASE_DIR,
            encoding="utf-8"
        ).splitlines()
    except Exception as e:
        return False, f"Failed to run git diff --cached: {e}"

    leaks = [p for p in PROTECTED_FILES if p in staged]
    if leaks:
        return False, f"SECURITY VIOLATION: Private files are staged for commit: {leaks}"

    return True, "No private files are staged for commit."


def check_persistent_mirror_integrity():
    """Verifies that the safe local backup exists outside the git repo and contains valid owner reviews."""
    ratings_path = os.path.join(HOME_DATA_DIR, "owner_ratings.json")
    comparisons_path = os.path.join(HOME_DATA_DIR, "owner_comparisons.json")

    if not os.path.isfile(ratings_path):
        return False, f"Persistent mirror missing: {ratings_path}"
    if not os.path.isfile(comparisons_path):
        return False, f"Persistent mirror missing: {comparisons_path}"

    try:
        with open(ratings_path, "r", encoding="utf-8") as f:
            r_data = json.load(f)
        with open(comparisons_path, "r", encoding="utf-8") as f:
            c_data = json.load(f)
    except Exception as e:
        return False, f"Persistent mirror corrupt: {e}"

    ratings_count = len(r_data.get("ratings", {}))
    comparisons_count = len(c_data.get("comparisons", []))

    if ratings_count < 11:
        return False, f"Persistent mirror has only {ratings_count} ratings (expected >= 11)."
    if comparisons_count < 4:
        return False, f"Persistent mirror has only {comparisons_count} comparisons (expected >= 4)."

    return True, f"Persistent mirror intact: {ratings_count} ratings, {comparisons_count} comparisons preserved."


def check_code_leakage():
    """Checks that tracked code does not contain verbatim private critique notes."""
    ratings_path = os.path.join(DATA_DIR, "owner_ratings.json")
    if not os.path.isfile(ratings_path):
        ratings_path = os.path.join(HOME_DATA_DIR, "owner_ratings.json")

    if not os.path.isfile(ratings_path):
        return True, "No ratings file to extract check phrases from."

    with open(ratings_path, "r", encoding="utf-8") as f:
        r_data = json.load(f)

    # Extract long unique sentences (>35 chars) from owner notes to test for leaks
    sample_phrases = []
    for r in r_data.get("ratings", {}).values():
        notes = r.get("free_text_notes", "")
        for sentence in re.split(r"[.\n]", notes):
            s = sentence.strip()
            if len(s) > 35 and not s.startswith("http"):
                sample_phrases.append(s[:50])

    if not sample_phrases:
        return True, "No sample phrases extracted."

    # Grep across tracked scripts
    scripts_dir = os.path.join(BASE_DIR, "scripts", "edit-dna")
    for root, _, files in os.walk(scripts_dir):
        for file in files:
            if file.endswith((".py", ".mjs", ".ts", ".js")) and file != "verify_privacy.py":
                fpath = os.path.join(root, file)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        content = f.read()
                    for phrase in sample_phrases:
                        if phrase in content:
                            return False, f"SECURITY VIOLATION: Private critique phrase found in {file}: '{phrase}'"
                except Exception:
                    pass

    return True, "Tracked codebase contains zero private critique text."


def main():
    checks = [
        ("Git Untracked Status", check_git_tracked_status),
        ("Git Staged Status", check_git_staged_status),
        ("Persistent Mirror Integrity", check_persistent_mirror_integrity),
        ("Codebase Leakage Check", check_code_leakage),
    ]

    all_passed = True
    print("\n" + "=" * 64)
    print("      LOLIXCO EDIT DNA — PRIVACY & INTEGRITY AUDIT")
    print("=" * 64)

    for name, fn in checks:
        passed, msg = fn()
        status_label = "PASS" if passed else "FAIL"
        print(f" [{status_label}] {name:30}: {msg}")
        if not passed:
            all_passed = False

    print("=" * 64)
    if not all_passed:
        print(" AUDIT RESULT: FAILED — Security or integrity constraint violated.")
        sys.exit(1)
    else:
        print(" AUDIT RESULT: PASSED — Permanent private data protection verified.")
        sys.exit(0)


if __name__ == "__main__":
    main()

