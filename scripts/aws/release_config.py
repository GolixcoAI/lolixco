"""Persistent public identifiers and exact transition origins; never credentials."""
import json
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


def load_release_config():
    config = json.loads((ROOT / 'config/aws-release.json').read_text())
    origins = config['allowed_origins']
    if not isinstance(origins, list) or not 1 <= len(origins) <= 2:
        raise ValueError('Use a narrow explicit origin allowlist')
    for origin in [config['public_origin'], config['preview_origin'], *origins]:
        parsed = urlsplit(origin)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.netloc != parsed.hostname or parsed.path or parsed.query or parsed.fragment or '*' in origin:
            raise ValueError('Origins must be exact HTTPS hostnames')
    if set(origins) - {config['public_origin'], config['preview_origin']} or config['public_origin'] not in origins:
        raise ValueError('Only the production and transition-preview origins are permitted')
    if not config['certificate_arn'].startswith('arn:aws:acm:us-east-1:' + config['account'] + ':certificate/'):
        raise ValueError('CloudFront requires the configured account certificate in us-east-1')
    if not isinstance(config['public_indexing'], bool):
        raise ValueError('Indexing must be an explicit boolean')
    return config
