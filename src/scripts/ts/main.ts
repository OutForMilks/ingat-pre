// One row of POST /api/search (see search_drugs in src/scripts/py/search.py).
interface SearchResult {
    name: string;
    nativized: string;
    /** CatBoost LASA probability, in percent. */
    score: number;
    look_alike: number;
    sound_alike: number;
    source: string;
    look_alike_scores: Record<string, number>;
    sound_alike_scores: Record<string, number>;
}

const RESULT_LIMIT = 20;
// CatBoost's default decision boundary.
const LIKELY_LASA_PERCENT = 50;

function getElement<T extends HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) {
        throw new Error(`Required page element not found: ${selector}`);
    }
    return element;
}

const input = getElement<HTMLInputElement>("#q");
const button = getElement<HTMLButtonElement>("#go");
const buttonLabel = getElement<HTMLSpanElement>("#go-label");
const spinner = getElement<HTMLSpanElement>("#loading-spinner");
const rows = getElement<HTMLTableSectionElement>("#rows");
const empty = getElement<HTMLDivElement>("#empty");
const nativizedHead = getElement<HTMLTableCellElement>("#nativized-head");
const arrangeOptions = getElement<HTMLFieldSetElement>("#arrange");
const showNativized = getElement<HTMLInputElement>("#show-nativized");
const showBreakdown = getElement<HTMLInputElement>("#show-breakdown");

let currentResults: SearchResult[] = [];

// On GitHub Pages the API is on the home server, behind a quick tunnel whose URL
// changes on every restart, so read the current one from tunnel.json. The
// timestamp gets past Pages' cache. Served from the server, the API is local.
async function apiBase(): Promise<string> {
    if (!location.hostname.endsWith("github.io")) {
        return "";
    }
    try {
        const response = await fetch(`tunnel.json?t=${Date.now()}`);
        const { url } = (await response.json()) as { url: string };
        return url.replace(/\/$/, "");
    } catch {
        throw new Error("Couldn't find the search server. Try again in a minute.");
    }
}

async function runSearch(query: string): Promise<SearchResult[]> {
    const response = await fetch(`${await apiBase()}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
        throw new Error(typeof body?.detail === "string" ? body.detail : "Search failed.");
    }
    return (await response.json()) as SearchResult[];
}

function inputLabel(feature: string): string {
    const name = feature
        .replace(/^core_/, "")
        .replace(/^aline_var:.*$/, "aline (Filipino)")
        .replaceAll("_", " ");
    return feature.startsWith("core_") ? `${name}, core word` : name;
}

function inputGroup(title: string, scores: Record<string, number>): DocumentFragment {
    const heading = document.createElement("h3");
    heading.textContent = title;

    const list = document.createElement("dl");
    list.className = "inputs";
    for (const [feature, value] of Object.entries(scores)) {
        const item = document.createElement("div");
        const name = document.createElement("dt");
        name.textContent = inputLabel(feature);
        const score = document.createElement("dd");
        score.textContent = Number.isInteger(value) ? String(value) : value.toFixed(3);
        item.append(name, score);
        list.append(item);
    }

    const group = document.createDocumentFragment();
    group.append(heading, list);
    return group;
}

function breakdownElement(result: SearchResult): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "breakdown";
    container.append(
        inputGroup("Look-alike", result.look_alike_scores),
        inputGroup("Sound-alike", result.sound_alike_scores),
    );
    return container;
}

function scoreContent(result: SearchResult): string | DocumentFragment {
    const score = `${result.score}%`;
    if (result.score < LIKELY_LASA_PERCENT) {
        return score;
    }

    const warning = document.createElement("span");
    warning.className = "warning";
    warning.title = `The classifier's probability is ${LIKELY_LASA_PERCENT}% or higher`;
    warning.textContent = "⚠ Likely LASA";

    const content = document.createDocumentFragment();
    content.append(score, warning);
    return content;
}

function arrangedResults(): SearchResult[] {
    const arrangement = arrangeOptions.querySelector<HTMLInputElement>(":checked")?.value;
    const measure = (result: SearchResult): number => {
        if (arrangement === "look") {
            return result.look_alike;
        }
        if (arrangement === "sound") {
            return result.sound_alike;
        }
        return result.score;
    };
    return [...currentResults]
        .sort((first, second) => measure(second) - measure(first))
        .slice(0, RESULT_LIMIT);
}

function renderResults(): void {
    const includeNativized = showNativized.checked;
    nativizedHead.hidden = !includeNativized;

    rows.replaceChildren(
        ...arrangedResults().flatMap((result, position) => {
            const row = document.createElement("tr");
            const values = [
                result.name,
                ...(includeNativized ? [result.nativized] : []),
                `${result.look_alike.toFixed(1)}%`,
                `${result.sound_alike.toFixed(1)}%`,
                scoreContent(result),
                result.source,
            ];

            for (const value of values) {
                const cell = document.createElement("td");
                cell.append(value);
                row.append(cell);
            }

            const rendered = [row];
            if (showBreakdown.checked) {
                const detail = document.createElement("tr");
                detail.className = "detail";
                const cell = document.createElement("td");
                cell.colSpan = values.length;
                cell.append(breakdownElement(result));
                detail.append(cell);
                rendered.push(detail);
            }

            if (position % 2 === 1) {
                rendered.forEach((element) => element.classList.add("alt"));
            }
            return rendered;
        }),
    );
}

function showResults(results: SearchResult[]): void {
    currentResults = results;
    renderResults();
}

async function search(): Promise<void> {
    const query = input.value.trim();

    if (!query) {
        empty.textContent = "Enter a proposed drug name to search.";
        empty.hidden = false;
        showResults([]);
        return;
    }

    button.disabled = true;
    buttonLabel.textContent = "Searching";
    spinner.hidden = false;
    empty.textContent = "Searching for similar drug names…";
    empty.hidden = false;
    showResults([]);

    try {
        const results = await runSearch(query);
        showResults(results);

        empty.textContent = results.length ? "" : "No matching drugs found.";
        empty.hidden = results.length > 0;
    } catch (error) {
        empty.textContent = error instanceof Error ? error.message : "Search failed.";
        empty.hidden = false;
        showResults([]);
    } finally {
        button.disabled = false;
        buttonLabel.textContent = "Search";
        spinner.hidden = true;
    }
}

arrangeOptions.addEventListener("change", renderResults);
showNativized.addEventListener("change", renderResults);
showBreakdown.addEventListener("change", renderResults);
button.addEventListener("click", search);
input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") {
        void search();
    }
});
