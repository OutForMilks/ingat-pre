# ingat, pre

_ingat ingat lng sa shabu..._

Mock website for PhoCA named IngatRX

## How it works

Everything runs on one server. The Python backend in `src/scripts/py` serves the page and the search API (`POST /api/search`), and the page calls that API.

For each search, the backend follows [walter](https://github.com/Mango-Cats/walter)'s pipeline:

1. **TagaBaybay** (`tbb-cli`, Rust) nativizes each word into Filipino spelling.
2. **Tagalog-G2P** (`tagalog-g2p`, the Phonetisaurus executable from [Taglog-G2P](https://github.com/Mango-Cats/Taglog-G2P)) transcribes that spelling to IPA.
3. **pho** (`phoc`, Rust) scores the query against every drug in `data/ph_GenBrn.csv` with the algorithms configured in `classifier_configs/`. It scores each pair twice: on the full names, and on their core words (`names.py`).
4. **CatBoost** (`models/c9_catboost.joblib`) combines those scores into a LASA probability.

The drug list's transcriptions are cached in `data/classifier_cache.csv`, so only the query is transcribed at search time.

### API

```http
POST /api/search
Content-Type: application/json

{"query": "Biogesic"}
```

The API returns a list of drugs. Each one has `name`, `nativized`, `score` (LASA probability, %), `look_alike`, `sound_alike`, `source`, and the per-algorithm scores in `look_alike_scores`, `sound_alike_scores` and `edit_counts`.

## Running

It needs:

- [uv](https://docs.astral.sh/uv/) and [Rust](https://rust-lang.org/tools/install/)
- `dist/tagalog-g2p` in a sibling `Taglog-G2P` checkout, or its path in the `TAGALOG_G2P` environment variable. It's a Linux binary, so on Windows it runs through WSL (`Ubuntu-22.04` by default; set `WSL_DISTRO` to change it)
- `phoc` (built from the `vendor/pho` submodule) and `tbb-cli` (at the TagaBaybay revision pho pins). `run.bat` builds both if they're missing. To use a `tbb-cli` from somewhere else, set `TBB_CLI`

To start it:

- **Windows:** double-click `run.bat`
- **Any terminal:** `cd src/scripts/py && uv run main.py`

Then open http://127.0.0.1:8000. Set `HOST` and `PORT` to listen somewhere else.

### Hosting with Cloudflare Tunnel

The page is on GitHub Pages (https://outformilks.github.io/ingat-pre/) and the API runs on the home server behind a Cloudflare quick tunnel:

```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

A quick tunnel gets a new URL each time it starts, so the home server commits the current one to `tunnel.json`. On GitHub Pages, the page reads `tunnel.json` before each search and sends the search to that URL. The tunnel URL itself also serves the whole site.

### Frontend

To rebuild the frontend after editing `src/scripts/ts/main.ts` (needs Node): `npm install` once, then `npm run build` (or `npm run watch`).
