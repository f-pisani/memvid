/**
 * Document Ingestion Example
 *
 * This example demonstrates how to ingest various document formats
 * into memvid, including automatic text extraction from PDFs, DOCX,
 * and other formats.
 *
 * Key concepts:
 * - put(): Store raw bytes with manual options
 * - putDocument(): Auto-extract text before storing
 * - extractDocument(): Extract text without storing
 * - blob(): Retrieve original raw bytes
 *
 * Supported formats:
 * - PDF (.pdf) - with text extraction
 * - Word (.docx) - with text extraction
 * - Excel (.xlsx, .xls) - with text extraction
 * - PowerPoint (.pptx) - with text extraction
 * - Plain text (.txt, .log, .json, .yaml, etc.)
 * - Markdown (.md)
 * - HTML (.html, .htm)
 * - Source code (most common extensions)
 */

import { create, open } from '@fpisani/memvid';
import * as fs from 'fs';
import * as path from 'path';

// Helper to access native handle
function getHandle(mem: any): any {
  return mem.handle || mem;
}

async function main() {
  const filePath = './document-ingestion-example.mv2';

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  console.log('=== Document Ingestion Example ===\n');

  const mem = create(filePath);
  const handle = getHandle(mem);
  mem.enableLex();

  // -------------------------------------------------------------------------
  // Step 1: Basic document storage with put()
  // -------------------------------------------------------------------------
  // The put() method stores raw bytes. You provide metadata manually.
  // This is the lowest-level storage method.

  console.log('--- Basic Storage with put() ---\n');

  // Store plain text
  const textContent = `
    Project Meeting Notes - January 2024

    Attendees: Alice, Bob, Carol
    Topics discussed:
    1. Q1 roadmap planning
    2. Technical debt review
    3. Hiring pipeline status

    Action items:
    - Alice to finalize roadmap by Friday
    - Bob to create tech debt tickets
    - Carol to schedule interviews
  `;

  const noteFrameId = mem.put(Buffer.from(textContent), {
    title: 'Meeting Notes - January 2024',
    uri: 'doc://meetings/2024-01',
    kind: 'notes',
    labels: ['meeting', 'planning', 'q1-2024'],
  });

  console.log(`Stored meeting notes with frame ID: ${noteFrameId}`);

  // Store JSON data
  const configData = {
    version: '1.0.0',
    features: {
      darkMode: true,
      notifications: true,
      analytics: false,
    },
    limits: {
      maxUploadSize: 10485760,
      maxConcurrentRequests: 100,
    },
  };

  const configFrameId = mem.put(Buffer.from(JSON.stringify(configData, null, 2)), {
    title: 'Application Configuration',
    uri: 'doc://config/app.json',
    kind: 'json',
    labels: ['config', 'application'],
  });

  console.log(`Stored config with frame ID: ${configFrameId}`);

  mem.commit();

  // -------------------------------------------------------------------------
  // Step 2: Document storage with auto-extraction using putDocument()
  // -------------------------------------------------------------------------
  // putDocument() automatically extracts text from the document for indexing.
  // The original bytes are stored, but extracted text is used for search.
  // This is ideal for PDFs, DOCX, etc.

  console.log('\n--- Auto-Extraction with putDocument() ---\n');

  // Simulate a text document (in practice, this could be PDF bytes)
  const reportContent = `
    Quarterly Report - Q4 2023

    Executive Summary:
    Revenue increased 15% compared to Q3, driven primarily by new
    enterprise customer acquisitions. Customer retention remained
    strong at 94%.

    Key Metrics:
    - Revenue: $2.5M
    - New Customers: 47
    - Churn Rate: 6%
    - NPS Score: 72

    Outlook:
    We expect continued growth in Q1 2024 with the launch of
    our new enterprise tier.
  `;

  // putDocument auto-extracts text and sets appropriate metadata
  const reportFrameId = handle.putDocument(Buffer.from(reportContent), 'q4-report.txt', {
    title: 'Q4 2023 Quarterly Report',
    // URI defaults to filename if not provided
    labels: ['report', 'quarterly', 'q4-2023'],
  });

  console.log(`Stored report with frame ID: ${reportFrameId}`);

  // Simulate a Markdown document
  const readmeContent = `
# Project README

## Overview
This project implements a high-performance vector database
for AI applications.

## Features
- Fast similarity search
- Persistent storage
- Multiple index types

## Installation
\`\`\`bash
npm install @fpisani/memvid
\`\`\`

## Usage
See examples directory for detailed usage patterns.
  `;

  const readmeFrameId = handle.putDocument(Buffer.from(readmeContent), 'README.md', {
    // Title and kind are auto-inferred from filename
    labels: ['documentation', 'readme'],
  });

  console.log(`Stored README with frame ID: ${readmeFrameId}`);

  mem.commit();

  // -------------------------------------------------------------------------
  // Step 3: Extract text without storing using extractDocument()
  // -------------------------------------------------------------------------
  // Sometimes you want to preview what text would be extracted
  // without actually storing the document.

  console.log('\n--- Text Extraction Preview ---\n');

  const sampleCode = `
/**
 * Calculate the Fibonacci sequence
 * @param n - The position in the sequence
 * @returns The Fibonacci number at position n
 */
export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// Example usage
console.log(fibonacci(10)); // Output: 55
  `;

  const extractionResult = handle.extractDocument(Buffer.from(sampleCode), 'fibonacci.ts');

  console.log('Extraction result:');
  console.log(`  Format detected: ${extractionResult.format}`);
  console.log(`  Page count: ${extractionResult.pageCount || 'N/A'}`);
  console.log(`  Warnings: ${extractionResult.warnings.length}`);
  console.log(`  Text preview: ${extractionResult.text.slice(0, 100)}...`);

  // -------------------------------------------------------------------------
  // Step 4: Retrieve raw bytes using blob()
  // -------------------------------------------------------------------------
  // The blob() method returns the original, unmodified bytes.
  // This is useful when you need to:
  // - Re-download the original file
  // - Process the file with external tools
  // - Verify file integrity

  console.log('\n--- Retrieving Raw Bytes with blob() ---\n');

  // Get timeline to find frame IDs
  const timeline = mem.timeline({ limit: 10, reverse: true });
  console.log(`Found ${timeline.length} frames in timeline`);

  // Retrieve the original config JSON
  const configBlob = handle.blob(configFrameId);
  const retrievedConfig = JSON.parse(configBlob.toString());

  console.log(`\nRetrieved config for frame ${configFrameId}:`);
  console.log(`  Version: ${retrievedConfig.version}`);
  console.log(`  Dark mode: ${retrievedConfig.features.darkMode}`);

  // Compare sizes
  const originalSize = Buffer.from(JSON.stringify(configData, null, 2)).length;
  console.log(`\n  Original size: ${originalSize} bytes`);
  console.log(`  Retrieved size: ${configBlob.length} bytes`);
  console.log(`  Match: ${originalSize === configBlob.length}`);

  // -------------------------------------------------------------------------
  // Step 5: Working with different file formats
  // -------------------------------------------------------------------------
  // Memvid auto-detects format based on file extension.

  console.log('\n--- File Format Support ---\n');

  const fileFormats = [
    { ext: '.txt', content: 'Plain text content', desc: 'Plain text' },
    { ext: '.json', content: '{"key": "value"}', desc: 'JSON' },
    { ext: '.yaml', content: 'key: value', desc: 'YAML' },
    { ext: '.md', content: '# Heading', desc: 'Markdown' },
    { ext: '.html', content: '<html><body>Hello</body></html>', desc: 'HTML' },
    { ext: '.py', content: 'print("Hello")', desc: 'Python' },
    { ext: '.ts', content: 'console.log("Hello")', desc: 'TypeScript' },
    { ext: '.rs', content: 'fn main() {}', desc: 'Rust' },
  ];

  for (const format of fileFormats) {
    const result = handle.extractDocument(Buffer.from(format.content), `test${format.ext}`);
    console.log(`  ${format.desc.padEnd(12)} (${format.ext}): format="${result.format}"`);
  }

  // -------------------------------------------------------------------------
  // Step 6: Batch document ingestion pattern
  // -------------------------------------------------------------------------
  // For ingesting many documents efficiently.

  console.log('\n--- Batch Ingestion Pattern ---\n');

  const documents = [
    { name: 'api-spec.yaml', content: 'openapi: 3.0.0\ninfo:\n  title: My API' },
    { name: 'schema.json', content: '{"type": "object", "properties": {}}' },
    { name: 'notes.md', content: '# Development Notes\n\nImportant considerations...' },
    { name: 'test.log', content: '[INFO] Application started\n[DEBUG] Loading config...' },
    { name: 'styles.css', content: '.container { display: flex; }' },
  ];

  console.log(`Ingesting ${documents.length} documents...`);

  const frameIds: number[] = [];
  for (const doc of documents) {
    const frameId = handle.putDocument(Buffer.from(doc.content), doc.name, {
      labels: ['batch-import'],
    });
    frameIds.push(frameId);
  }

  mem.commit();
  console.log(`Stored documents with frame IDs: [${frameIds.join(', ')}]`);

  // -------------------------------------------------------------------------
  // Step 7: Search across all documents
  // -------------------------------------------------------------------------

  console.log('\n--- Searching Ingested Documents ---\n');

  // Search using the lex index
  const searchResults = mem.find('config', 5);
  console.log(`Search for "config" found ${searchResults.totalHits} results:`);
  for (const hit of searchResults.hits) {
    console.log(`  [${hit.frameId}] ${hit.title || hit.uri}`);
    console.log(`       Snippet: ${hit.text.slice(0, 60)}...`);
  }

  // -------------------------------------------------------------------------
  // Step 8: View vs Blob comparison
  // -------------------------------------------------------------------------
  // view() returns text content (may be decoded/extracted)
  // blob() returns raw bytes (original format)

  console.log('\n--- view() vs blob() ---\n');

  // Store a document
  const htmlDoc = '<html><head><title>Test</title></head><body><p>Hello World</p></body></html>';
  const htmlFrameId = handle.putDocument(Buffer.from(htmlDoc), 'page.html', {});
  mem.commit();

  // view() returns as text
  const viewContent = mem.view(htmlFrameId);
  console.log(`view() length: ${viewContent.length} characters`);
  console.log(`view() preview: ${viewContent.slice(0, 50)}...`);

  // blob() returns raw bytes
  const blobContent = handle.blob(htmlFrameId);
  console.log(`\nblob() length: ${blobContent.length} bytes`);
  console.log(`blob() preview: ${blobContent.toString().slice(0, 50)}...`);

  // -------------------------------------------------------------------------
  // Step 9: Frame metadata
  // -------------------------------------------------------------------------

  console.log('\n--- Frame Metadata ---\n');

  const frameInfo = mem.frame(noteFrameId);
  console.log(`Frame ${noteFrameId} metadata:`);
  console.log(`  - ID: ${frameInfo.id}`);
  console.log(`  - Title: ${frameInfo.title}`);
  console.log(`  - URI: ${frameInfo.uri}`);
  console.log(`  - Kind: ${frameInfo.kind}`);
  console.log(`  - Payload length: ${frameInfo.payloadLength} bytes`);
  console.log(`  - Timestamp: ${new Date(frameInfo.timestamp).toISOString()}`);

  // -------------------------------------------------------------------------
  // Final statistics
  // -------------------------------------------------------------------------

  console.log('\n--- Final Statistics ---\n');

  const stats = mem.stats();
  console.log(`Total frames: ${stats.frameCount}`);
  console.log(`Active frames: ${stats.activeFrameCount}`);
  console.log(`Total size: ${stats.sizeBytes} bytes`);
  console.log(`Payload bytes: ${stats.payloadBytes}`);
  console.log(`Compression ratio: ${stats.compressionRatioPercent.toFixed(1)}%`);
  console.log(`Savings: ${stats.savingsPercent.toFixed(1)}%`);

  // Cleanup
  mem.close();
  fs.unlinkSync(filePath);

  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
