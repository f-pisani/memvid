# Examples

Example scripts demonstrating how to use `@fpisani/memvid`.

## Prerequisites

Build the package first:

```bash
cd native
npm install
npm run build
```

## Running Examples

Examples use [tsx](https://github.com/privatenumber/tsx) to run TypeScript directly:

```bash
# Basic usage (no API key required)
npx tsx examples/basic-usage.ts

# Vector search (requires OpenAI API key)
OPENAI_API_KEY=sk-... npx tsx examples/vector-search.ts

# Batch ingestion (works with or without API key)
OPENAI_API_KEY=sk-... npx tsx examples/batch-ingestion.ts
```

## Examples

| Example | Description | API Key Required |
|---------|-------------|------------------|
| `basic-usage.ts` | Create, store, text search, timeline | No |
| `vector-search.ts` | Semantic search with embeddings | Yes (OpenAI) |
| `batch-ingestion.ts` | Efficient batch document ingestion | Optional |
