"""Compare private provider values against tracked source and explicit build directories.

Reads secrets into memory only. Reports filenames and status; never matching text.
"""

import argparse
import json
import logging
from pathlib import Path
import subprocess
import sys

from migrate_provider_secrets import read_local_keys


def inspect_files(paths, values):
    needles = [value.encode() for value in values.values()]
    leaks = []
    inspected = 0
    for path in paths:
        path = Path(path)
        if path.is_symlink():
            raise RuntimeError("Scan inputs must not be symbolic links")
        if not path.is_file():
            continue
        inspected += 1
        # Preserve cross-chunk matches without loading large artifacts at once.
        with path.open("rb") as handle:
            tail = b""
            while chunk := handle.read(1024 * 1024):
                chunk = tail + chunk
                if any(value in chunk for value in needles):
                    leaks.append(str(path))
                    break
                tail = chunk[-max(map(len, needles)):]
    return {"status": "passed" if not leaks else "failed", "inspected_files": inspected, "files_with_credentials": leaks}


def main():
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--root", default=Path(__file__).resolve().parents[2], type=Path)
    parser.add_argument("--build-dir", action="append", default=[], type=Path)
    args = parser.parse_args()
    try:
        values = read_local_keys(args.env_file)
        names = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd=args.root, check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout
        paths = {args.root / name.decode() for name in names.split(b"\0") if name}
        for folder in args.build_dir:
            if not folder.is_dir() or folder.is_symlink():
                raise RuntimeError("Build directory unavailable")
            paths.update(folder.rglob("*"))
        result = inspect_files(sorted(paths), values)
        print(json.dumps({"test": "provider_credential_exposure", **result}))
        return 0 if result["status"] == "passed" else 1
    except Exception:
        print(json.dumps({"test": "provider_credential_exposure", "status": "scan_unavailable"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
