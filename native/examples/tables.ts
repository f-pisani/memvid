/**
 * Table Extraction Example
 *
 * This example demonstrates how to extract, store, and query
 * tabular data from PDF documents.
 *
 * Key concepts:
 * - extractTables(): Extract tables from PDF bytes
 * - listTables(): List all stored tables
 * - getTable(): Get a specific table by ID
 * - exportTableCsv(): Export table to CSV format
 * - exportTableJson(): Export table to JSON format
 *
 * Table extraction modes:
 * - conservative: High precision, may miss some tables
 * - standard: Balanced approach (default)
 * - aggressive: Catches more tables, may include noise
 * - lattice_only: Only tables with visible cell borders
 * - stream_only: Only tables without visible borders
 *
 * Note: This example simulates table operations since actual
 * PDF table extraction requires valid PDF files with tables.
 */

import { create, open } from '@fpisani/memvid';
import * as fs from 'fs';

// Helper to access native handle
function getHandle(mem: any): any {
  return mem.handle || mem;
}

async function main() {
  const filePath = './tables-example.mv2';

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  console.log('=== Table Extraction Example ===\n');

  const mem = create(filePath);
  const handle = getHandle(mem);
  mem.enableLex();

  // -------------------------------------------------------------------------
  // Step 1: Understanding Table Extraction Options
  // -------------------------------------------------------------------------
  // Before extracting tables, you configure the extraction behavior.

  console.log('--- Table Extraction Options ---\n');

  console.log('Available extraction modes:');
  console.log('  - conservative: High precision, fewer false positives');
  console.log('  - standard:     Balanced (default)');
  console.log('  - aggressive:   Catches more tables, may include noise');
  console.log('  - lattice_only: Only tables with visible borders');
  console.log('  - stream_only:  Only tables without visible borders');

  console.log('\nAvailable options:');
  console.log('  - mode:           Extraction mode (see above)');
  console.log('  - minRows:        Minimum rows for valid table (default: 2)');
  console.log('  - minCols:        Minimum columns for valid table (default: 2)');
  console.log('  - mergeMultiPage: Merge tables spanning pages (default: false)');
  console.log('  - maxPages:       Max pages to process (0 = all)');

  // -------------------------------------------------------------------------
  // Step 2: Simulated Table Extraction
  // -------------------------------------------------------------------------
  // In production, you would have actual PDF bytes.
  // Here we demonstrate the API patterns.

  console.log('\n--- Table Extraction API ---\n');

  console.log('Table extraction requires valid PDF bytes:');
  console.log(`
  // Example with real PDF:
  const pdfBytes = fs.readFileSync('report.pdf');
  const tables = handle.extractTables(pdfBytes, 'report.pdf', {
    mode: 'conservative',
    minRows: 3,
    minCols: 2,
    mergeMultiPage: true,
    maxPages: 10,
  });

  for (const table of tables) {
    console.log(\`Table ID: \${table.tableId}\`);
    console.log(\`Page: \${table.page}\`);
    console.log(\`Dimensions: \${table.nRows}x\${table.nCols}\`);
    console.log(\`Quality: \${table.quality}\`);
    console.log(\`Headers: \${table.headers.join(', ')}\`);
  }
  `);

  // Try with an empty buffer to show error handling
  console.log('\nDemonstrating error handling with invalid PDF:');
  try {
    handle.extractTables(Buffer.from([]), 'empty.pdf', { mode: 'conservative' });
  } catch (error) {
    console.log(`  Expected error: ${(error as Error).message.slice(0, 60)}...`);
  }

  // -------------------------------------------------------------------------
  // Step 3: List Stored Tables
  // -------------------------------------------------------------------------
  // After extraction, tables are stored and can be listed.

  console.log('\n--- Listing Stored Tables ---\n');

  const storedTables = handle.listTables();
  console.log(`Found ${storedTables.length} stored tables`);

  if (storedTables.length > 0) {
    console.log('\nStored tables:');
    for (const summary of storedTables) {
      console.log(`  Table ID: ${summary.tableId}`);
      console.log(`    Title: ${summary.title}`);
      console.log(`    Dimensions: ${summary.nRows}x${summary.nCols}`);
      console.log(`    Headers: ${summary.headers.join(', ')}`);
      console.log(`    Frame ID: ${summary.frameId}`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Get Specific Table
  // -------------------------------------------------------------------------
  // Retrieve a table by its ID for detailed access.

  console.log('\n--- Get Table by ID ---\n');

  console.log('Example usage:');
  console.log(`
  const table = handle.getTable('table_001');
  if (table) {
    console.log('Headers:', table.headers);
    console.log('Rows:', table.rows.length);

    // Access row data
    for (const row of table.rows.slice(0, 5)) {
      console.log(row.join(' | '));
    }
  }
  `);

  // Try to get a non-existent table
  const nonExistentTable = handle.getTable('non-existent-table');
  console.log(`Get non-existent table: ${nonExistentTable}`); // null

  // -------------------------------------------------------------------------
  // Step 5: Export Tables
  // -------------------------------------------------------------------------
  // Tables can be exported to CSV or JSON format.

  console.log('\n--- Table Export Formats ---\n');

  console.log('CSV Export:');
  console.log(`
  const csv = handle.exportTableCsv('table_001');
  fs.writeFileSync('output.csv', csv);

  // CSV format:
  // "Name","Age","Department"
  // "Alice","30","Engineering"
  // "Bob","25","Marketing"
  `);

  console.log('\nJSON Export:');
  console.log(`
  const json = handle.exportTableJson('table_001');
  const data = JSON.parse(json);

  // JSON format:
  // {
  //   "tableId": "table_001",
  //   "headers": ["Name", "Age", "Department"],
  //   "rows": [
  //     {"Name": "Alice", "Age": "30", "Department": "Engineering"},
  //     {"Name": "Bob", "Age": "25", "Department": "Marketing"}
  //   ]
  // }
  `);

  // -------------------------------------------------------------------------
  // Step 6: Simulated Table Workflow
  // -------------------------------------------------------------------------
  // Let's simulate a complete table workflow with mock data.

  console.log('\n--- Simulated Table Workflow ---\n');

  // Store tabular data as JSON (workaround without PDF)
  const employeeData = {
    headers: ['ID', 'Name', 'Department', 'Salary', 'Start Date'],
    rows: [
      ['E001', 'Alice Chen', 'Engineering', '$120,000', '2021-03-15'],
      ['E002', 'Bob Smith', 'Marketing', '$95,000', '2020-08-01'],
      ['E003', 'Carol Jones', 'Engineering', '$135,000', '2019-11-22'],
      ['E004', 'David Lee', 'Sales', '$85,000', '2022-01-10'],
      ['E005', 'Eve Wilson', 'Engineering', '$110,000', '2021-07-05'],
    ],
  };

  // Store as a structured document
  mem.put(Buffer.from(JSON.stringify(employeeData, null, 2)), {
    title: 'Employee Directory',
    uri: 'table://employees',
    kind: 'table-data',
    labels: ['hr', 'employees', 'directory'],
  });

  // Store as searchable text for lex index
  const tableAsText = [
    employeeData.headers.join('\t'),
    ...employeeData.rows.map((row) => row.join('\t')),
  ].join('\n');

  mem.put(Buffer.from(tableAsText), {
    title: 'Employee Directory (Text)',
    uri: 'table://employees/text',
    kind: 'table-text',
    labels: ['hr', 'employees'],
  });

  mem.commit();

  console.log('Stored employee data in two formats:');
  console.log('  1. JSON format for programmatic access');
  console.log('  2. Tab-separated text for search');

  // Search for employees
  console.log('\nSearching for "Engineering":');
  const searchResults = mem.find('Engineering', 5);
  for (const hit of searchResults.hits) {
    console.log(`  [${hit.frameId}] ${hit.title}`);
    console.log(`       ${hit.text.slice(0, 80)}...`);
  }

  // -------------------------------------------------------------------------
  // Step 7: Table Analysis Patterns
  // -------------------------------------------------------------------------

  console.log('\n--- Table Analysis Patterns ---\n');

  // Retrieve and parse JSON table
  const timeline = mem.timeline({ limit: 10 });
  const jsonFrame = timeline.find((e) => e.uri === 'table://employees');

  if (jsonFrame) {
    const tableJson = mem.view(jsonFrame.frameId);
    const table = JSON.parse(tableJson);

    console.log(`Table: Employee Directory`);
    console.log(`Columns: ${table.headers.length}`);
    console.log(`Rows: ${table.rows.length}`);

    // Calculate statistics
    const salaries = table.rows
      .map((row: string[]) => parseFloat(row[3].replace(/[$,]/g, '')))
      .filter((s: number) => !isNaN(s));

    const avgSalary = salaries.reduce((a: number, b: number) => a + b, 0) / salaries.length;
    const maxSalary = Math.max(...salaries);
    const minSalary = Math.min(...salaries);

    console.log('\nSalary Statistics:');
    console.log(`  Average: $${avgSalary.toLocaleString()}`);
    console.log(`  Max: $${maxSalary.toLocaleString()}`);
    console.log(`  Min: $${minSalary.toLocaleString()}`);

    // Filter rows
    const engineers = table.rows.filter((row: string[]) => row[2] === 'Engineering');
    console.log(`\nEngineering employees: ${engineers.length}`);
    for (const eng of engineers) {
      console.log(`  - ${eng[1]} (${eng[3]})`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 8: Best Practices for Table Extraction
  // -------------------------------------------------------------------------

  console.log('\n--- Best Practices ---\n');

  console.log('1. Start with conservative mode and loosen if needed');
  console.log('2. Set appropriate minRows/minCols to filter noise');
  console.log('3. Use mergeMultiPage for tables spanning pages');
  console.log('4. Export to JSON for programmatic access');
  console.log('5. Export to CSV for spreadsheet compatibility');
  console.log('6. Store extracted text alongside for search');
  console.log('7. Use labels to categorize table types');

  // -------------------------------------------------------------------------
  // Final statistics
  // -------------------------------------------------------------------------

  console.log('\n--- Final Statistics ---\n');

  const stats = mem.stats();
  console.log(`Total frames: ${stats.frameCount}`);
  console.log(`File size: ${stats.sizeBytes} bytes`);

  // Cleanup
  mem.close();
  fs.unlinkSync(filePath);

  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
