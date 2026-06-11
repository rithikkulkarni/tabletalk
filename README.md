# TableTalk

TableTalk is a natural-language data exploration tool. You point it at a dataset, ask questions in plain English, and it figures out the SQL, runs it against an in-memory SQLite database, and renders the results as a filtered grid or chart — all in one shot. It's built for analysts and stakeholders who need to dig into tabular data without writing queries.

The AI backend uses Google Gemini (with an Ollama fallback for local/offline use). The frontend is a single-page Next.js app with a chat sidebar, a data grid, and a chart panel.

---

## Prerequisites

- Node.js 18+
- A [Google AI Studio](https://aistudio.google.com/app/apikey) API key (free tier works fine for development)

If you want to run fully offline, you can use Ollama instead — see the [AI provider config](#ai-provider) section below.

---

## Getting started

```bash
git clone <your-fork>
cd tabletalk-1
npm install
cp .env.local.example .env.local
```

Fill in your key in `.env.local`:

```
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash-lite
AI_PROVIDER=gemini
```

Then:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You should see the app with a "Candy Store Sales" demo dataset loaded by default.

---

## Project structure

```
app/
  page.tsx              # Main page — owns all top-level state
  api/
    datasets/route.ts   # Returns list of available datasets
    analyze/route.ts    # The AI pipeline — this is the core logic
  globals.css           # All custom styles (Tailwind + CSS vars for theming)

components/
  DataGrid.tsx          # TanStack Table-based grid with column reordering/sorting
  ChartPanel.tsx        # Chart.js panel, renders bar/line/pie based on AI output
  ChatSidebar.tsx       # Chat UI and conversation history
  ControlsPanel.tsx     # Dataset selector and saved view management
  ConfigPanel.tsx       # JSON editor for table/chart config (power user feature)
  RowDetailModal.tsx    # Full row detail overlay
  CsvImportModal.tsx    # CSV upload flow

lib/
  types.ts              # All shared TypeScript types
  datasets.ts           # Dataset loading and in-memory SQLite caching
  ai-prompt.ts          # System prompts and few-shot examples fed to the model
  analysis.ts           # SQL generation, execution, and error repair
  chart-factory.ts      # Converts query results into Chart.js config objects
```

---

## How the AI pipeline works

When a user sends a message, `POST /api/analyze` runs a two-phase pipeline:

1. **Decision phase** — sends the user's message, the dataset schema, and conversation history to the model. The model returns a structured response: what "mode" to respond in (`answer`, `grid`, `visual`, `visual_change`), and a list of SQL steps to execute.

2. **Execution phase** — each SQL step runs against the in-memory SQLite database. Results from step N are stored as `__step_N` and can be referenced by later steps. If a query fails, the model gets one repair attempt before the error surfaces to the user.

3. **Answer phase** — a final model call generates a plain-English summary of the query results.

If you want to change how the model interprets queries or generates SQL, `lib/ai-prompt.ts` is where all that lives. It has the system prompt, the JSON schema the model is expected to return, and several few-shot examples.

---

## Adding datasets

Datasets are defined in `lib/datasets.ts`. Each dataset is a JavaScript object with a name, column schema, and row data. The data gets loaded into SQLite on first query and cached in a `Map` keyed by dataset ID.

To add a new dataset:

1. Add an entry to the `DATASETS` array in `lib/datasets.ts`
2. Define the column types so the AI knows how to query it
3. The dataset will show up automatically in the dataset selector dropdown

For large datasets, keep in mind this is in-process SQLite — it's fast but not designed for millions of rows.

---

## AI provider

Two providers are supported, controlled by the `AI_PROVIDER` env var.

**Gemini (default):**
```
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.0-flash-lite
```

**Ollama (local):**
```
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
```

Ollama quality will vary — the prompts are tuned for Gemini and rely on structured JSON output. If you're using a smaller local model, you may need to simplify the system prompt in `lib/ai-prompt.ts`.

The Anthropic SDK is also a dependency (`@ai-sdk/anthropic`) if you want to swap in Claude — `app/api/analyze/route.ts` is where the provider is initialized.

---

## State and persistence

There's no database for user state. Everything lives in React state on `page.tsx`. Two things persist to `localStorage`:

- `tt-theme` — light/dark preference
- `tt-panels` — which panels are visible

Saved views are in-memory only and reset on refresh. If you want persistence, that's the first place to add it.

---

## Linting

```bash
npm run lint
```

TypeScript strict mode is on. The project uses the default Next.js ESLint config.
