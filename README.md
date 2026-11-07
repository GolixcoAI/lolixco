# Lolixco

Lolixco is a platform for discovering cinematic video edits across anime, movies, series, gaming, and more.

The project brings together curated video edits, Shorts, search, and personalized recommendations, with support for YouTube and licensed hosted content.

## Local Creator Studio

Run `pnpm studio`, then open <http://127.0.0.1:5173/?view=studio>.
The launcher starts both loopback services. Use Ctrl+C to stop them.
The analyzer needs FFmpeg, FFprobe, and a Python environment with OpenCV, FastAPI, librosa, NumPy, and Uvicorn. Set `LOLIXCO_DNA_PYTHON` to select that environment if needed.

Import a supported video or audio file and choose **Start AI Analysis**.
Studio accepts up to 100 MiB and 120 seconds per file. Video is limited to 60 fps, 1,920 pixels on either edge, and 2,073,600 pixels per frame. Temporary copies expire after an hour. Saved reports can be exported or deleted in Studio.

Creator Studio reads private backend settings from `scripts/local-dna/.env.local`.
Fill the empty `GEMINI_API_KEY=` and `YOUTUBE_API_KEY=` fields there.
Set `LOLIXCO_GEMINI_YOUTUBE=1` after adding your Gemini key to enable consented public-video review.
Run `pnpm studio:restart` from this project to reload the backend settings and both local services. Use Ctrl+C to stop services in the attached terminal.
The launcher creates the empty template when needed. Process environment settings take precedence over the file.

Gemini discovery and inference run in the analyzer. Each public-video review requires browser consent and uses the configured API quota. Local imports use offline analysis. The current YouTube iframe and publisher preview work without a Data API key. `YOUTUBE_API_KEY` is reserved for operations that need that API. Restrict any configured key to its intended Google API and the appropriate server application restrictions. [Google API key guidance](https://ai.google.dev/gemini-api/docs/api-key) and [YouTube authorization](https://developers.google.com/youtube/registering_an_application).

Storytelling and creative-execution scores use experimental Gemini rubrics with timestamped evidence from the reviewed interval. The evidence details show the scope, strengths, weaknesses, suggestions, and model. Comparative originality requires a reference collection. The rubric thresholds await independent human calibration. [Editor evaluation research](https://arxiv.org/abs/2608.24329) and [editing technique evaluation](https://arxiv.org/abs/2609.08275).

Owner fit uses a separate local preference model and independent owner feedback. It needs compatible extraction methods, distinct reviewed inputs, and improvement against held-out baselines. To record a rating from an exported local report, run `LOLIXCO_DNA_PYTHON`'s Python executable with `scripts/local-dna/owner_fit.py feedback --report /path/to/report.json --score 8.0`. Feedback is stored privately under `~/.lolixco-edit-dna/`.
