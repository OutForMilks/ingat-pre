from pathlib import Path
import csv
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from search import prepare_drugs, search_drugs

ROOT_DIR = Path(__file__).parents[3]
DRUG_CSV = Path(__file__).parent / "data" / "ph_GenBrn.csv"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))


def load_drug_names() -> list[str]:
    with DRUG_CSV.open(newline="", encoding="utf-8-sig") as csv_file:
        return [row["Drug Names"] for row in csv.DictReader(csv_file)]


prepared_drugs = prepare_drugs(load_drug_names())
if not prepared_drugs:
    raise RuntimeError(f"{DRUG_CSV.name} has no usable drug names.")
print(f"Loaded {len(prepared_drugs)} drug transcriptions from {DRUG_CSV.name}.")

app = FastAPI()
# Lets the page on GitHub Pages call the API. The copy served from this server
# is on the same origin, so it needs no CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://outformilks.github.io"],
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)


@app.post("/api/search")
def search(request: SearchRequest):
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=422, detail="Enter a drug name.")

    try:
        return search_drugs(query, prepared_drugs)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


# Serve the frontend from the same server so one command runs everything.
@app.get("/", include_in_schema=False)
def index():
    return FileResponse(ROOT_DIR / "index.html")


app.mount("/src", StaticFiles(directory=ROOT_DIR / "src"), name="src")


if __name__ == "__main__":
    import uvicorn

    print(f"IngatRX running at http://{HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT)
