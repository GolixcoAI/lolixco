# Lolixco

Lolixco is a platform for discovering cinematic video edits across anime, movies, series, gaming, and more.

The project brings together curated video edits, Shorts, search, and personalized recommendations, with support for YouTube and licensed hosted content.

## Local Creator Studio

Run `pnpm studio`, then open <http://127.0.0.1:5173/?view=studio>.
The launcher starts both loopback services. Use Ctrl+C to stop them.
The analyzer needs FFmpeg, FFprobe, and a Python environment with OpenCV, FastAPI, librosa, NumPy, and Uvicorn. Set `LOLIXCO_DNA_PYTHON` to select that environment if needed.

For a fresh Python setup, create `.venv` with `python3 -m venv .venv`, then install `scripts/local-dna/requirements.txt` with `.venv/bin/pip`. Run `LOLIXCO_DNA_PYTHON="$PWD/.venv/bin/python" pnpm studio`. The isolated regression suite also finds this repository environment, so CI and local checks use the same dependencies.

Six historical owner-calibration checks run locally when the private ratings/media fixtures are present and report explicit skips in a clean CI checkout. Git privacy checks and portable analyzer/service regressions run in CI using repository or temporary synthetic fixtures. Private owner archives are not CI inputs.

Choose **Upload Video** or **Paste YouTube Link**, then select **Analyze Edit**. The first external review asks how the edit may be processed.
Studio accepts up to 100 MiB and 120 seconds per input. FFmpeg prepares a private analysis copy capped at 640px and 60fps, preserving the original file and source timing. Common MP4, MOV, MKV, WebM and audio inputs are supported when the installed FFmpeg can decode them. Browser preview may be unavailable for codecs such as HEVC while backend analysis remains available. Temporary files expire after an hour. Reports can be exported and deleted in Studio.

Creator Studio reads private backend settings from `scripts/local-dna/.env.local`.
Fill the empty `GEMINI_API_KEY=` and `YOUTUBE_API_KEY=` fields there.
Set `LOLIXCO_GEMINI_YOUTUBE=1` after adding your Gemini key to enable consented public-video review.
Run `pnpm studio:restart` from this project to reload the backend settings and both local services. Use Ctrl+C to stop services in the attached terminal.
The launcher creates the empty template when needed. Process environment settings take precedence over the file.

Gemini discovery and inference run in the analyzer. Each public-video review requires browser consent and uses the configured API quota. Uploaded files use signal analysis unless their separate Google processing permission is granted. The configured YouTube Data API key supplies public availability, duration and publisher metadata; an oEmbed fallback works without it. The Data API does not supply video streams. Restrict each key to its intended Google API and the appropriate server application restrictions. [Google API key guidance](https://ai.google.dev/gemini-api/docs/api-key) and [YouTube authorization](https://developers.google.com/youtube/registering_an_application).

The current six dimensions are audiovisual rhythm, cuts and transitions, pacing, visual craftsmanship, storytelling and coherence, and creative execution and impact. Offline processing supplies technical measurements and eligible signal proxies. An optional Gemini review uses timestamped rubric criteria across all six dimensions, with strengths, weaknesses, suggestions and explicit sampling limits. Local hybrid review separates a focused audiovisual-rhythm pass from the five visual/editorial rubrics, with shared request deadlines and per-pass provenance. A six-category mean appears only when all six semantic assessments meet the evidence checks. Artistic ratings remain experimental. A small blinded comparison with existing editorial reviews measured disagreement while keeping labels local. Its sample size and differing rubric scopes cannot establish rating accuracy or calibration; detailed aggregates stay outside git. [Editor evaluation research](https://arxiv.org/abs/2608.24329) and [editing technique evaluation](https://arxiv.org/abs/2609.08275).

Public YouTube review sends a public URL through the official Gemini video-understanding API. External review requires an informed processing choice. File and public-link permissions are separate; users can remember each choice on this browser and change it in **Analysis privacy**. Changes apply to future reviews. It sends a transient, metadata-stripped video/audio rendition of up to two minutes, transmitted inline without a reusable provider file. Google's API processing and data terms apply. Signal analysis remains available when external processing is declined.

Studio defaults to the discovered `gemini-3.1-flash-lite` model for public review and the five local editorial rubrics. The focused local rhythm pass prefers account-visible `gemini-3.5-flash`, which handled the generated audible test more reliably during diagnosis. An explicit backend `LOLIXCO_GEMINI_MODEL` setting can select another discovered video-capable Flash model. Model discovery verifies account access. Each generation can still encounter a separately reported authentication, quota, input, model or timeout failure. Historical seven-dimension reports are safely imported with the current six categories and their historical overall withheld. Existing private research and rating history are retained.

## Stage 16 release review

The public frontend defaults analysis off until `VITE_ANALYSIS_ENABLED=true` is deliberately set for an approved same-origin service. This flag is not authentication or multi-user isolation. The loopback development worker must not be exposed publicly. Developer sample and animation controls require a development build plus `?studioTools=1`.

See [product acceptance](docs/product/STAGE16_ACCEPTANCE.md) and [release blockers and rollback](docs/infra/STAGE16_RELEASE_READINESS.md). The Stage 18 owner instructions authorize controlled release engineering and the prepared media's publication. Final domain cutover and PR merge still require owner approval; the Stage 16 document records the earlier readiness assessment.

## AWS provider credentials

The owner-run [SDK migration](scripts/aws/migrate_provider_secrets.py) reads the existing ignored backend `.env.local` directly, validates only `GEMINI_API_KEY` and `YOUTUBE_API_KEY`, and creates or updates the encrypted `lolixco/production/ai/providers` secret. Repeated runs with unchanged keys do not create a new credential version. The original file is read without rewriting it or changing its permissions.

Only `LolixcoProductionAIBackend` can retrieve the secret. The migration operator, frontend, CI and unrelated Copilot roles are denied secret reads. Production startup uses the nonsecret `LOLIXCO_PROVIDER_SECRET_ARN` setting and the task's AWS identity; it fails closed if managed configuration cannot load. Set `LOLIXCO_DEPLOYMENT=production` to require this behavior even when the ARN is accidentally omitted. Never put either provider key in a `VITE_` variable or an infrastructure template.

See the [migration, verification and rotation runbook](docs/infra/STAGE18_PROVIDER_SECRETS.md) for commands, exact IAM requirements and current verification evidence. Cloud authentication checks verify managed-secret retrieval, Gemini model discovery and official YouTube metadata access without AI generation. They do not establish a deployed, public multi-user analysis service.
