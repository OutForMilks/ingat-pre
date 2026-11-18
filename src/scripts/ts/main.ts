// One row of POST /api/search (see search_drugs in src/scripts/py/search.py).
interface SearchResult {
    name: string;
    nativized: string;
    /** "Generic", "Brand" or "Generic and brand"; missing when unknown. */
    name_type?: string | null;
    /** The query's own Filipino spelling. Missing from older backends. */
    query_nativized?: string;
    /** CatBoost LASA probability, in percent. */
    score: number;
    look_alike: number;
    sound_alike: number;
    source: string;
    look_alike_scores: Record<string, number>;
    sound_alike_scores: Record<string, number>;
    edit_counts?: Record<string, number>;
}

const RESULT_LIMIT = 20;
// CatBoost's default decision boundary. Scores at or above it are shown in red.
const LIKELY_LASA_PERCENT = 50;
// Scores at or above this, but under LIKELY_LASA_PERCENT, are shown in yellow.
const POSSIBLE_LASA_PERCENT = 20;

// Plain-English names for the algorithms behind each score, keyed by phoc column.
const MEASURE_LABELS: Record<string, string> = {
    levenshtein: "Same letters in the same order",
    levenshtein_consonant: "Same consonants in the same order",
    prefix: "Starts the same way",
    lcsuf: "Ends the same way",
    lcsubstring: "Longest run of shared letters",
    visual_weighted: "Letters that look alike, like m and n",
    aline: "Sounds alike when said in Filipino",
    editex: "Letters that sound alike, like c and k",
    bisim: "Shared pairs of letters",
};

type NamePart = "full" | "core";

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
const rows = getElement<HTMLDivElement>("#rows");
const empty = getElement<HTMLDivElement>("#empty");
const arrangeOptions = getElement<HTMLFieldSetElement>("#arrange");
const nameTypeOptions = getElement<HTMLFieldSetElement>("#name-types");

const details = getElement<HTMLDialogElement>("#details");
const detailsTitle = getElement<HTMLHeadingElement>("#details-title");
const detailsClose = getElement<HTMLButtonElement>("#details-close");
const detailsVerdict = getElement<HTMLDivElement>("#details-verdict");
const detailsSpelled = getElement<HTMLDivElement>("#details-spelled");
const detailsParts = getElement<HTMLDivElement>("#details-parts");
const detailsLook = getElement<HTMLUListElement>("#details-look");
const detailsSound = getElement<HTMLUListElement>("#details-sound");
const detailsEdits = getElement<HTMLUListElement>("#details-edits");
const detailsEditsSection = getElement<HTMLDivElement>("#details-edits-section");

let currentResults: SearchResult[] = [];
let currentQuery = "";
let openResult: SearchResult | null = null;
let openPart: NamePart = "full";

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

async function runSearch(query: string, nameTypes: string[]): Promise<SearchResult[]> {
    const response = await fetch(`${await apiBase()}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, name_types: nameTypes }),
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
        throw new Error(typeof body?.detail === "string" ? body.detail : "Search failed.");
    }
    return (await response.json()) as SearchResult[];
}

function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const created = document.createElement(tag);
    if (className) {
        created.className = className;
    }
    if (text !== undefined) {
        created.textContent = text;
    }
    return created;
}

function riskLevel(score: number): "high" | "possible" | "low" {
    if (score >= LIKELY_LASA_PERCENT) {
        return "high";
    }
    return score >= POSSIBLE_LASA_PERCENT ? "possible" : "low";
}

function scoreBadge(score: number): HTMLSpanElement {
    const level = riskLevel(score);
    const badge = element("span", `lasa ${level}`, `${score}%`);
    if (level === "high") {
        badge.title = `Likely LASA: ${LIKELY_LASA_PERCENT}% or higher`;
    } else if (level === "possible") {
        badge.title = `Possible LASA: ${POSSIBLE_LASA_PERCENT}% to ${LIKELY_LASA_PERCENT}%`;
    }
    return badge;
}

function alike(percent: number): string {
    if (percent >= 80) {
        return "very alike";
    }
    if (percent >= 60) {
        return "quite alike";
    }
    if (percent >= 40) {
        return "a little alike";
    }
    return "not alike";
}

function measureKey(feature: string): string {
    return feature.replace(/^core_/, "").replace(/^aline_var:.*$/, "aline");
}

function scoresFor(scores: Record<string, number>, part: NamePart): [string, number][] {
    return Object.entries(scores).filter(
        ([feature]) => feature.startsWith("core_") === (part === "core"),
    );
}

function measureRow(what: string, tech: string, value: string): HTMLLIElement {
    const item = element("li");
    const label = element("div");
    label.append(element("div", "what", what), element("div", "tech", tech));
    item.append(label, element("div", "value", value));
    return item;
}

function fillMeasures(list: HTMLUListElement, scores: [string, number][]): void {
    list.replaceChildren(
        ...scores.map(([feature, value]) => {
            const key = measureKey(feature);
            return measureRow(
                MEASURE_LABELS[key] ?? key.replaceAll("_", " "),
                feature.replace(/^core_/, ""),
                `${(value * 100).toFixed(0)}%`,
            );
        }),
    );
}

function fillDetailScores(): void {
    if (!openResult) {
        return;
    }
    // The browser lib has no DOM.Iterable, so NodeList uses forEach, not for...of.
    detailsParts.querySelectorAll<HTMLButtonElement>("button").forEach((option) => {
        option.setAttribute("aria-pressed", String(option.dataset.part === openPart));
    });
    fillMeasures(detailsLook, scoresFor(openResult.look_alike_scores, openPart));
    fillMeasures(detailsSound, scoresFor(openResult.sound_alike_scores, openPart));
}

// Levenshtein edit counts (levenshtein_separate.toml): letters swapped, and letters added or removed.
const EDIT_MEASURES: [string, string][] = [
    ["levenshtein_separate_substitutions", "Letters to change"],
    ["levenshtein_separate_indels", "Letters to add or remove"],
];

function fillEdits(counts: Record<string, number> | undefined): void {
    const items = EDIT_MEASURES.filter(([feature]) => counts?.[feature] !== undefined).map(
        ([feature, what]) => {
            const count = Math.round(counts![feature]);
            return measureRow(what, feature, `${count} letter${count === 1 ? "" : "s"}`);
        },
    );
    detailsEdits.replaceChildren(...items);
    detailsEditsSection.hidden = items.length === 0;
}

function spelling(label: string, text: string): HTMLDivElement {
    const box = element("div");
    box.append(element("span", undefined, label), element("b", undefined, text));
    return box;
}

function openDetails(result: SearchResult): void {
    openResult = result;
    openPart = "full";

    detailsTitle.textContent = `${currentQuery} vs ${result.name}`;

    const level = riskLevel(result.score);
    const heading = {
        high: "Likely to be mixed up.",
        possible: "Could be mixed up.",
        low: "Unlikely to be mixed up.",
    }[level];
    const sentence = element("p");
    sentence.append(
        element("b", undefined, heading),
        ` The model gives a ${result.score}% chance that these names get confused. ` +
            `They look ${alike(result.look_alike)} (${result.look_alike.toFixed(0)}%) ` +
            `and sound ${alike(result.sound_alike)} (${result.sound_alike.toFixed(0)}%).`,
    );
    detailsVerdict.replaceChildren(scoreBadge(result.score), sentence);

    detailsSpelled.replaceChildren(
        ...(result.query_nativized ? [spelling(currentQuery, result.query_nativized)] : []),
        spelling(result.name, result.nativized),
    );

    fillEdits(result.edit_counts);

    fillDetailScores();
    details.showModal();
}

// Display names for the API's source ids.
const SOURCE_LABELS: Record<string, string> = {
    ph_GenBrn: "Philippine FDA",
};

function selectedNameTypes(): string[] {
    return Array.from(
        nameTypeOptions.querySelectorAll<HTMLInputElement>("input:checked"),
        (option) => option.value,
    );
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

function similarity(label: string, percent: number): HTMLDivElement {
    const cell = element("div", "similarity");
    cell.append(element("span", "cell-label", label), `${percent.toFixed(1)}%`);
    return cell;
}

function renderResults(): void {
    rows.replaceChildren(
        ...arrangedResults().map((result, position) => {
            const row = element("div", position % 2 === 1 ? "result-row alt" : "result-row");
            row.setAttribute("role", "listitem");

            const name = element("div", "drug-name", result.name);
            if (result.name_type) {
                name.append(element("small", undefined, result.name_type));
            }

            const lasa = element("div");
            lasa.append(element("span", "cell-label", "LASA probability"), scoreBadge(result.score));

            const source = element("div", "source");
            source.append(element("span", "cell-label", "Source/s"), SOURCE_LABELS[result.source] ?? result.source);

            const open = element("button", "details-button", "Details");
            open.type = "button";
            open.setAttribute("aria-label", `Details for ${result.name}`);
            open.addEventListener("click", () => openDetails(result));

            row.append(
                name,
                similarity("Look-alike similarity", result.look_alike),
                similarity("Sound-alike similarity", result.sound_alike),
                lasa,
                source,
                open,
            );
            return row;
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

    const nameTypes = selectedNameTypes();
    if (!nameTypes.length) {
        empty.textContent = "Choose Generic Name, Brand Name, or both.";
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
        const results = await runSearch(query, nameTypes);
        currentQuery = query;
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
// The backend picks the top matches among the chosen kinds of names, so search again.
nameTypeOptions.addEventListener("change", () => {
    if (input.value.trim()) {
        void search();
    }
});
button.addEventListener("click", search);
input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") {
        void search();
    }
});

detailsParts.addEventListener("click", (event: MouseEvent) => {
    const option = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-part]");
    if (option) {
        openPart = option.dataset.part as NamePart;
        fillDetailScores();
    }
});
detailsClose.addEventListener("click", () => details.close());
// A click on the dimmed area outside the popup lands on the dialog itself.
details.addEventListener("click", (event: MouseEvent) => {
    if (event.target === details) {
        details.close();
    }
});
