# Lolixco

Lolixco is a platform for discovering cinematic video edits across anime, movies, series, gaming, and more.

The project brings together curated video edits, Shorts, search, and personalized recommendations, with support for YouTube and licensed hosted content.

## Local Creator Studio

Run `pnpm studio`, then open <http://127.0.0.1:5173/?view=studio>.
The launcher starts both loopback services. Use Ctrl+C to stop them.
The analyzer needs FFmpeg, FFprobe, and a Python environment with OpenCV, FastAPI, librosa, NumPy, and Uvicorn. Set `LOLIXCO_DNA_PYTHON` to select that environment if needed.

Import a supported video or audio file and choose **Start AI Analysis**.
Studio accepts up to 100 MiB and 120 seconds per file. Video is limited to 60 fps, 1,920 pixels on either edge, and 2,073,600 pixels per frame. Temporary copies expire after an hour. Saved reports can be exported or deleted in Studio.

Public YouTube analysis requires an explicit server-side opt-in. Set `LOLIXCO_GEMINI_YOUTUBE=1` and provide `GEMINI_API_KEY` in the analyzer environment before starting Studio. The browser asks for consent before sending a public URL for experimental audiovisual review. Preview availability is separate from analysis availability.
