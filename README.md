# ingat, pre

_ingat ingat lng sa shabu..._

Mock website for PhoCA named IngatRX

## How it works

The page is on GitHub Pages, and the Python backend in `src/scripts/py` runs the search API (`POST /api/search`) on a home server. The backend can also serve the page itself, so one machine can run everything.

For each search, the backend follows [walter](https://github.com/Mango-Cats/walter)'s pipeline:

1. **TagaBaybay** (`tbb-cli`, Rust) nativizes each word into Filipino spelling.
2. **Tagalog-G2P** (`tagalog-g2p`, the Phonetisaurus executable from [Taglog-G2P](https://github.com/Mango-Cats/Taglog-G2P)) transcribes that spelling to IPA.
3. **pho** (`phoc`, Rust) scores the query against every drug in `data/ph_GenBrn.csv` with the algorithms configured in `classifier_configs/`. It scores each pair twice: on the full names, and on their core words (`names.py`).
4. **CatBoost** (`models/c9_catboost.joblib`) combines those scores into a LASA probability.

The drug list's transcriptions are cached in `data/classifier_cache.csv`, so only the query is transcribed at search time.

`data/ph_name_types.csv` labels each drug name as generic, brand or both. It comes from matching the names against the Generic Name and Brand Name columns of the PH FDA registry (`drug product.csv` in the dataset cleaning project), normalized the same way as `ph_GenBrn.csv`. About 125 names that were corrected during cleaning have no label.

### API

```http
POST /api/search
Content-Type: application/json

{"query": "Biogesic", "name_types": ["Generic", "Brand"]}
```

`name_types` is optional. Leave it out, or list both, to search every drug name. With one type, only names of that type are searched (names that are both generic and brand count for either), and the roughly 125 names with no known type are skipped.

The API returns a list of drugs. Each one has `name`, `name_type` (`Generic`, `Brand`, `Generic and brand`, or `null` when unknown), `nativized`, `query_nativized` (the query's own Filipino spelling), `score` (LASA probability, %), `look_alike`, `sound_alike`, `source`, and the per-algorithm scores in `look_alike_scores`, `sound_alike_scores` and `edit_counts`.

## Running

It needs:

- [uv](https://docs.astral.sh/uv/) and [Rust](https://rust-lang.org/tools/install/)
- `dist/tagalog-g2p` in a sibling `Taglog-G2P` checkout, or its path in the `TAGALOG_G2P` environment variable. It's a Linux binary, so on Windows it runs through WSL (`Ubuntu-22.04` by default; set `WSL_DISTRO` to change it)
- `phoc` (built from the `vendor/pho` submodule) and `tbb-cli` (at the TagaBaybay revision pho pins). `run.bat` builds both if they're missing. To use a `tbb-cli` from somewhere else, set `TBB_CLI`
- [eSpeak NG](https://github.com/espeak-ng/espeak-ng), which `tbb-cli` uses through the `phonemizer` Python package. `tbb-cli` installs `phonemizer` with `uv run` the first time it starts, so that first start needs internet access

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

### Home server

The home server is Ubuntu with no Rust toolchain. The **Build Linux tools** workflow (run it from the Actions tab) builds `phoc` and `tbb-cli` on GitHub and publishes them as the `linux-tools` release. To install them on the server:

```bash
curl -L -C - -o linux-tools.tar.gz https://github.com/OutForMilks/ingat-pre/releases/download/linux-tools/linux-tools.tar.gz
tar -xzf linux-tools.tar.gz -C /tmp
mv /tmp/phoc ~/ingat-api/vendor/pho/target/release/
mv /tmp/tbb-cli ~/ingat-api/src/scripts/py/.tbb/bin/
```

The backend runs from a separate clone at `~/ingat-api` as the `ingat-api` systemd service on port 8000. To update it:

```bash
git -C ~/ingat-api pull
sudo systemctl restart ingat-api
```

### Frontend

To rebuild the frontend after editing `src/scripts/ts/main.ts` (needs Node): `npm install` once, then `npm run build` (or `npm run watch`).
