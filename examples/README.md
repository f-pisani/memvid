# memvid-node Examples

Example scripts demonstrating how to use `@fpisani/memvid` from npm.

## Setup

```bash
cd examples
npm install
```

## Running Examples

```bash
# Basic usage (no API key required)
npm run basic

# Vector search (requires OpenAI API key)
OPENAI_API_KEY=sk-... npm run vector

# Batch ingestion (works with or without API key)
OPENAI_API_KEY=sk-... npm run batch
```

## Examples

| Example | Description | API Key Required |
|---------|-------------|------------------|
| `basic-usage.ts` | Create, store, text search, timeline | No |
| `vector-search.ts` | Semantic search with embeddings | Yes (OpenAI) |
| `batch-ingestion.ts` | Efficient batch document ingestion | Optional |
