"""Load the analyzer's own private configuration before provider imports."""

import os
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name(".env.local")
CONFIG_KEYS = {"GEMINI_API_KEY", "YOUTUBE_API_KEY", "LOLIXCO_GEMINI_YOUTUBE", "LOLIXCO_GEMINI_MODEL"}
TEMPLATE = """# Private Creator Studio backend settings. Restart pnpm studio after editing.
GEMINI_API_KEY=
YOUTUBE_API_KEY=

# Enable public YouTube Gemini review after adding your key. Each run asks for consent.
LOLIXCO_GEMINI_YOUTUBE=0
"""


def requires_aws_configuration(environment):
    return bool(
        environment.get("LOLIXCO_PROVIDER_SECRET_ARN")
        or environment.get("LOLIXCO_DEPLOYMENT") == "production"
        or environment.get("AWS_EXECUTION_ENV", "").startswith(("AWS_ECS", "AWS_Lambda"))
        or environment.get("ECS_CONTAINER_METADATA_URI_V4")
        or environment.get("ECS_CONTAINER_METADATA_URI")
    )


def load_configuration(path=CONFIG_PATH, environment=None):
    """Existing process variables take precedence. Values are never logged or expanded."""
    environment = os.environ if environment is None else environment
    secret_arn = environment.get("LOLIXCO_PROVIDER_SECRET_ARN", "")
    if requires_aws_configuration(environment):
        from aws_provider_secrets import load_aws_configuration
        return load_aws_configuration(secret_arn, environment)
    path = Path(path)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        if path.is_symlink() or not path.is_file():
            raise RuntimeError("Use a regular private backend .env.local file.")
    else:
        with os.fdopen(descriptor, "w") as file:
            file.write(TEMPLATE)
    path.chmod(0o600)
    if path.stat().st_size > 16384:
        raise RuntimeError("The backend configuration exceeds its supported size.")
    for line in path.read_text().splitlines():
        content = line.strip()
        if not content or content.startswith("#"):
            continue
        name, separator, value = content.partition("=")
        name = name.strip()
        if name not in CONFIG_KEYS or not separator:
            raise RuntimeError("Use only the documented backend settings in .env.local.")
        value = value.strip()
        if value.startswith(("'", '"')):
            if len(value) < 2 or value[-1] != value[0]:
                raise RuntimeError("A backend setting has an unterminated quoted value.")
            value = value[1:-1]
        if any(character.isspace() for character in value):
            raise RuntimeError("Backend API settings must each occupy one line without spaces.")
        environment.setdefault(name, value)
    return environment
