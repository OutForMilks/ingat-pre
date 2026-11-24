const RESULT_LIMIT = 20;
// CatBoost's default decision boundary. Scores at or above it are shown in red.
const LIKELY_LASA_PERCENT = 50;
// Scores at or above this, but under LIKELY_LASA_PERCENT, are shown in yellow.
const POSSIBLE_LASA_PERCENT = 20;
// Plain-English names for the algorithms behind each score, keyed by phoc column.
const MEASURE_LABELS = {
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
function getElement(selector) {
    const element = document.querySelector(selector);
    if (!element) {
        throw new Error(`Required page element not found: ${selector}`);
    }
    return element;
}
const input = getElement("#q");
const button = getElement("#go");
const buttonLabel = getElement("#go-label");
const spinner = getElement("#loading-spinner");
const rows = getElement("#rows");
const empty = getElement("#empty");
const arrangeOptions = getElement("#arrange");
const nameTypeOptions = getElement("#name-types");
const details = getElement("#details");
const detailsTitle = getElement("#details-title");
const detailsClose = getElement("#details-close");
const detailsVerdict = getElement("#details-verdict");
const detailsSpelled = getElement("#details-spelled");
const detailsParts = getElement("#details-parts");
const detailsLook = getElement("#details-look");
const detailsSound = getElement("#details-sound");
const detailsEdits = getElement("#details-edits");
const detailsEditsSection = getElement("#details-edits-section");
const printButton = getElement("#print");
const report = getElement("#report");
let currentResults = [];
let currentQuery = "";
let currentNameTypes = [];
let openResult = null;
let openPart = "full";
// On GitHub Pages the API is on the home server, behind a quick tunnel whose URL
// changes on every restart, so read the current one from tunnel.json. The
// timestamp gets past Pages' cache. Served from the server, the API is local.
async function apiBase() {
    if (!location.hostname.endsWith("github.io")) {
        return "";
    }
    try {
        const response = await fetch(`tunnel.json?t=${Date.now()}`);
        const { url } = (await response.json());
        return url.replace(/\/$/, "");
    }
    catch {
        throw new Error("Couldn't find the search server. Try again in a minute.");
    }
}
async function runSearch(query, nameTypes) {
    const response = await fetch(`${await apiBase()}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, name_types: nameTypes }),
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => null));
        throw new Error(typeof body?.detail === "string" ? body.detail : "Search failed.");
    }
    return (await response.json());
}
function element(tag, className, text) {
    const created = document.createElement(tag);
    if (className) {
        created.className = className;
    }
    if (text !== undefined) {
        created.textContent = text;
    }
    return created;
}
function riskLevel(score) {
    if (score >= LIKELY_LASA_PERCENT) {
        return "high";
    }
    return score >= POSSIBLE_LASA_PERCENT ? "possible" : "low";
}
function scoreBadge(score) {
    const level = riskLevel(score);
    const badge = element("span", `lasa ${level}`, `${score}%`);
    if (level === "high") {
        badge.title = `Likely LASA: ${LIKELY_LASA_PERCENT}% or higher`;
    }
    else if (level === "possible") {
        badge.title = `Possible LASA: ${POSSIBLE_LASA_PERCENT}% to ${LIKELY_LASA_PERCENT}%`;
    }
    return badge;
}
function alike(percent) {
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
function measureKey(feature) {
    return feature.replace(/^core_/, "").replace(/^aline_var:.*$/, "aline");
}
function scoresFor(scores, part) {
    return Object.entries(scores).filter(([feature]) => feature.startsWith("core_") === (part === "core"));
}
function measureRow(what, tech, value) {
    const item = element("li");
    const label = element("div");
    label.append(element("div", "what", what), element("div", "tech", tech));
    item.append(label, element("div", "value", value));
    return item;
}
function fillMeasures(list, scores) {
    list.replaceChildren(...scores.map(([feature, value]) => {
        const key = measureKey(feature);
        return measureRow(MEASURE_LABELS[key] ?? key.replaceAll("_", " "), feature.replace(/^core_/, ""), `${(value * 100).toFixed(0)}%`);
    }));
}
function fillDetailScores() {
    if (!openResult) {
        return;
    }
    // The browser lib has no DOM.Iterable, so NodeList uses forEach, not for...of.
    detailsParts.querySelectorAll("button").forEach((option) => {
        option.setAttribute("aria-pressed", String(option.dataset.part === openPart));
    });
    fillMeasures(detailsLook, scoresFor(openResult.look_alike_scores, openPart));
    fillMeasures(detailsSound, scoresFor(openResult.sound_alike_scores, openPart));
}
// Levenshtein edit counts (levenshtein_separate.toml): letters swapped, and letters added or removed.
const EDIT_MEASURES = [
    ["levenshtein_separate_substitutions", "Letters to change"],
    ["levenshtein_separate_indels", "Letters to add or remove"],
];
function fillEdits(counts) {
    const items = EDIT_MEASURES.filter(([feature]) => counts?.[feature] !== undefined).map(([feature, what]) => {
        const count = Math.round(counts[feature]);
        return measureRow(what, feature, `${count} letter${count === 1 ? "" : "s"}`);
    });
    detailsEdits.replaceChildren(...items);
    detailsEditsSection.hidden = items.length === 0;
}
function spelling(label, text) {
    const box = element("div");
    box.append(element("span", undefined, label), element("b", undefined, text));
    return box;
}
function openDetails(result) {
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
    sentence.append(element("b", undefined, heading), ` The model gives a ${result.score}% chance that these names get confused. ` +
        `They look ${alike(result.look_alike)} (${result.look_alike.toFixed(0)}%) ` +
        `and sound ${alike(result.sound_alike)} (${result.sound_alike.toFixed(0)}%).`);
    detailsVerdict.replaceChildren(scoreBadge(result.score), sentence);
    detailsSpelled.replaceChildren(...(result.query_nativized ? [spelling(currentQuery, result.query_nativized)] : []), spelling(result.name, result.nativized));
    fillEdits(result.edit_counts);
    fillDetailScores();
    details.showModal();
}
// Display names for the API's source ids.
const SOURCE_LABELS = {
    ph_GenBrn: "Philippine FDA",
};
function sourceLabel(source) {
    return SOURCE_LABELS[source] ?? source;
}
function selectedNameTypes() {
    return Array.from(nameTypeOptions.querySelectorAll("input:checked"), (option) => option.value);
}
function arrangedResults() {
    const arrangement = arrangeOptions.querySelector(":checked")?.value;
    const measure = (result) => {
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
function similarity(label, percent) {
    const cell = element("div", "similarity");
    cell.append(element("span", "cell-label", label), `${percent.toFixed(1)}%`);
    return cell;
}
function renderResults() {
    rows.replaceChildren(...arrangedResults().map((result, position) => {
        const row = element("div", position % 2 === 1 ? "result-row alt" : "result-row");
        row.setAttribute("role", "listitem");
        const name = element("div", "drug-name", result.name);
        if (result.name_type) {
            name.append(element("small", undefined, result.name_type));
        }
        const lasa = element("div");
        lasa.append(element("span", "cell-label", "LASA probability"), scoreBadge(result.score));
        const source = element("div", "source");
        source.append(element("span", "cell-label", "Source/s"), sourceLabel(result.source));
        const open = element("button", "details-button", "Details");
        open.type = "button";
        open.setAttribute("aria-label", `Details for ${result.name}`);
        open.addEventListener("click", () => openDetails(result));
        row.append(name, similarity("Look-alike similarity", result.look_alike), similarity("Sound-alike similarity", result.sound_alike), lasa, source, open);
        return row;
    }));
}
function showResults(results) {
    currentResults = results;
    printButton.disabled = results.length === 0;
    renderResults();
}
// Printed report: a plain black-and-white document. Scores in the yellow or red
// range on screen are classified LASA; the rest are Not LASA.
function lasaLabel(score) {
    return riskLevel(score) === "low" ? "Not LASA" : "LASA";
}

function reportField(label, value) {
    const field = element("div");
    field.append(element("dt", undefined, `${label}:`), element("dd", undefined, value));
    return field;
}

function reportRow(result, position) {
    const row = element("tr");
    row.append(
        element("td", "num", String(position + 1)),
        element("td", undefined, result.name),
        element("td", undefined, result.name_type ?? "Unknown"),
        element("td", "num", `${result.look_alike.toFixed(1)}%`),
        element("td", "num", `${result.sound_alike.toFixed(1)}%`),
        element("td", "num", `${result.score}%`),
        element("td", undefined, lasaLabel(result.score)),
        element("td", undefined, sourceLabel(result.source)),
    );
    return row;
}

function buildReport() {
    const results = arrangedResults();
    const sources = Array.from(new Set(results.map((result) => sourceLabel(result.source))));
    const generated = new Date().toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" });

    const head = element("div", "report-head");
    head.append(
        element("p", undefined, "IngatRX"),
        element("h1", undefined, "Look-Alike Sound-Alike (LASA) Screening Report"),
    );

    const meta = element("dl", "report-meta");
    meta.append(
        reportField("Proposed drug name", currentQuery),
        reportField("Date generated", generated),
        reportField("Name types compared", currentNameTypes.join(" and ")),
        reportField("Data source/s", sources.join(", ")),
    );

    const headRow = element("tr");
    // Long headers break onto two lines (white-space: pre) so the numeric columns stay narrow.
    const columns = [
        ["No.", "num"],
        ["Drug name"],
        ["Name type"],
        ["Look-alike\nsimilarity", "num"],
        ["Sound-alike\nsimilarity", "num"],
        ["LASA\nprobability", "num"],
        ["Classification"],
        ["Source/s"],
    ];
    headRow.append(...columns.map(([label, className]) => element("th", className, label)));
    const thead = element("thead");
    thead.append(headRow);
    const tbody = element("tbody");
    tbody.append(...results.map((result, position) => reportRow(result, position)));
    const table = element("table", "report-table");
    table.append(thead, tbody);

    const note = element("p", "report-note");
    note.append(
        "Note: LASA probability is the model's estimate of how likely the proposed name is to be " +
            "confused with the listed drug name. It is based on how similar the two names look in writing " +
            "and how similar they sound when read aloud in Filipino. Names at " +
            `${POSSIBLE_LASA_PERCENT}% or higher are classified as LASA, and names below ` +
            `${POSSIBLE_LASA_PERCENT}% as Not LASA. These results are `,
        element("b", undefined, "for screening only"),
        " and do not replace review by a qualified expert.",
    );

    const signatures = element("div", "report-signatures");
    signatures.append(
        ...["Prepared by", "Reviewed by"].map((role) => {
            const block = element("div");
            block.append(
                element("p", undefined, `${role}:`),
                element("div", "report-line"),
                element("p", undefined, "Signature over printed name"),
                element("div", "report-line"),
                element("p", undefined, "Date"),
            );
            return block;
        }),
    );

    report.replaceChildren(head, meta, table, note, signatures);
}

// Build the report for the print button and for Ctrl+P. With no results, the page prints as is.
const pageTitle = document.title;
window.addEventListener("beforeprint", () => {
    if (!currentResults.length) {
        return;
    }
    buildReport();
    document.body.classList.add("printing-report");
    // Browsers name a saved PDF after the page title.
    document.title = `IngatRX LASA report - ${currentQuery}`;
});
window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing-report");
    document.title = pageTitle;
});
printButton.addEventListener("click", () => window.print());
async function search() {
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
        currentNameTypes = nameTypes;
        showResults(results);
        empty.textContent = results.length ? "" : "No matching drugs found.";
        empty.hidden = results.length > 0;
    }
    catch (error) {
        empty.textContent = error instanceof Error ? error.message : "Search failed.";
        empty.hidden = false;
        showResults([]);
    }
    finally {
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
input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        void search();
    }
});
detailsParts.addEventListener("click", (event) => {
    const option = event.target.closest("button[data-part]");
    if (option) {
        openPart = option.dataset.part;
        fillDetailScores();
    }
});
detailsClose.addEventListener("click", () => details.close());
// A click on the dimmed area outside the popup lands on the dialog itself.
details.addEventListener("click", (event) => {
    if (event.target === details) {
        details.close();
    }
});
