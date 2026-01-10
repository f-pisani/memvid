/**
 * File Maintenance Example
 *
 * This example demonstrates how to maintain and repair memvid files
 * using the doctor() function and other maintenance operations.
 *
 * Key concepts:
 * - doctor(): Diagnose and optionally repair file issues
 * - verify(): Check file integrity
 * - update(): Modify frame metadata
 * - delete(): Soft-delete frames
 * - stats(): Monitor file health
 *
 * The doctor() function performs:
 * - Header validation
 * - WAL (Write-Ahead Log) integrity checks
 * - Index consistency verification
 * - Frame corruption detection
 * - Optional automatic repairs
 */

import { create, open, doctor, version } from '@fpisani/memvid';
import * as fs from 'fs';

// Helper to access native handle
function getHandle(mem: any): any {
  return mem.handle || mem;
}

async function main() {
  const filePath = './maintenance-example.mv2';

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  console.log('=== File Maintenance Example ===\n');
  console.log(`Memvid version: ${version()}\n`);

  // -------------------------------------------------------------------------
  // Step 1: Create a file with test data
  // -------------------------------------------------------------------------
  console.log('--- Creating Test File ---\n');

  let mem = create(filePath);
  const handle = getHandle(mem);
  mem.enableLex();

  // Add various documents
  const documents = [
    { content: 'First document about TypeScript', title: 'TypeScript Intro', kind: 'article' },
    { content: 'Second document about Rust', title: 'Rust Guide', kind: 'tutorial' },
    { content: 'Third document about Python', title: 'Python Basics', kind: 'article' },
    { content: 'Fourth document about databases', title: 'DB Concepts', kind: 'reference' },
    { content: 'Fifth document about cloud services', title: 'Cloud Overview', kind: 'article' },
  ];

  const frameIds: number[] = [];
  for (const doc of documents) {
    const frameId = mem.put(Buffer.from(doc.content), {
      title: doc.title,
      kind: doc.kind,
      labels: ['test', 'maintenance-demo'],
    });
    frameIds.push(frameId);
    console.log(`Created frame ${frameId}: ${doc.title}`);
  }

  mem.commit();
  mem.close();

  console.log(`\nCreated ${documents.length} frames in ${filePath}`);

  // -------------------------------------------------------------------------
  // Step 2: Basic verification
  // -------------------------------------------------------------------------
  console.log('\n--- Basic Verification ---\n');

  mem = open(filePath);

  // Quick verification (header only)
  const quickValid = mem.verify(false);
  console.log(`Quick verify (header): ${quickValid ? 'PASS' : 'FAIL'}`);

  // Deep verification (checksums all frames)
  const deepValid = mem.verify(true);
  console.log(`Deep verify (all frames): ${deepValid ? 'PASS' : 'FAIL'}`);

  mem.close();

  // -------------------------------------------------------------------------
  // Step 3: Using doctor() for diagnosis
  // -------------------------------------------------------------------------
  console.log('\n--- Doctor Diagnosis Mode ---\n');

  // Run doctor in diagnosis mode (fix=false)
  // This scans for issues without modifying the file
  const diagnosisResult = doctor(filePath, false);

  console.log('Doctor diagnosis results:');
  console.log(`  Issues found: ${diagnosisResult.issuesFound}`);
  console.log(`  Issues fixed: ${diagnosisResult.issuesFixed}`);

  if (diagnosisResult.actions.length > 0) {
    console.log(`  Actions (${diagnosisResult.actions.length}):`);
    for (const action of diagnosisResult.actions) {
      console.log(`    - ${action}`);
    }
  } else {
    console.log('  No issues detected - file is healthy');
  }

  // -------------------------------------------------------------------------
  // Step 4: Using doctor() for repair
  // -------------------------------------------------------------------------
  console.log('\n--- Doctor Repair Mode ---\n');

  // Run doctor in repair mode (fix=true)
  // This will attempt to fix any detected issues
  const repairResult = doctor(filePath, true);

  console.log('Doctor repair results:');
  console.log(`  Issues found: ${repairResult.issuesFound}`);
  console.log(`  Issues fixed: ${repairResult.issuesFixed}`);

  if (repairResult.actions.length > 0) {
    console.log(`  Actions taken:`);
    for (const action of repairResult.actions) {
      console.log(`    - ${action}`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: Monitoring file statistics
  // -------------------------------------------------------------------------
  console.log('\n--- File Statistics ---\n');

  mem = open(filePath);
  const stats = mem.stats();

  console.log('File health metrics:');
  console.log(`  Total frames: ${stats.frameCount}`);
  console.log(`  Active frames: ${stats.activeFrameCount}`);
  console.log(`  Deleted frames: ${stats.frameCount - stats.activeFrameCount}`);
  console.log(`  File size: ${stats.sizeBytes} bytes`);
  console.log(`  Payload bytes: ${stats.payloadBytes}`);
  console.log(`  Logical bytes: ${stats.logicalBytes}`);
  console.log(`  Saved by compression: ${stats.savedBytes} bytes (${stats.savingsPercent.toFixed(1)}%)`);
  console.log(`  Compression ratio: ${stats.compressionRatioPercent.toFixed(1)}%`);
  console.log(`  Avg frame size: ${stats.averageFramePayloadBytes} bytes`);

  console.log('\nIndex status:');
  console.log(`  Lex (text) index: ${stats.hasLexIndex ? 'enabled' : 'disabled'}`);
  console.log(`  Vec (vector) index: ${stats.hasVecIndex ? 'enabled' : 'disabled'}`);
  console.log(`  CLIP index: ${stats.hasClipIndex ? 'enabled' : 'disabled'}`);
  console.log(`  Time index: ${stats.hasTimeIndex ? 'enabled' : 'disabled'}`);
  console.log(`  Vector count: ${stats.vectorCount}`);

  // -------------------------------------------------------------------------
  // Step 6: Updating frame metadata
  // -------------------------------------------------------------------------
  console.log('\n--- Updating Frame Metadata ---\n');

  // Get a frame to update
  const timeline = mem.timeline({ limit: 1 });
  const frameToUpdate = timeline[0];

  console.log(`Before update (frame ${frameToUpdate.frameId}):`);
  const beforeInfo = mem.frame(frameToUpdate.frameId);
  console.log(`  Title: ${beforeInfo.title}`);
  console.log(`  Kind: ${beforeInfo.kind}`);

  // Update the frame's metadata
  handle.update(frameToUpdate.frameId, {
    title: 'Updated Title - TypeScript Introduction',
    kind: 'updated-article',
    labels: ['test', 'updated', 'v2'],
  });

  mem.commit();

  // Note: The update modifies internal metadata but frame() may show
  // original values depending on implementation
  console.log('\nMetadata update operation completed');

  // -------------------------------------------------------------------------
  // Step 7: Soft-deleting frames
  // -------------------------------------------------------------------------
  console.log('\n--- Soft Delete Operations ---\n');

  console.log('Before deletion:');
  const statsBefore = mem.stats();
  console.log(`  Total frames: ${statsBefore.frameCount}`);
  console.log(`  Active frames: ${statsBefore.activeFrameCount}`);

  // Soft delete a frame (marks as deleted but keeps data)
  const frameToDelete = frameIds[frameIds.length - 1]; // Last frame
  console.log(`\nDeleting frame ${frameToDelete}...`);
  mem.delete(frameToDelete);
  mem.commit();

  console.log('\nAfter deletion:');
  const statsAfter = mem.stats();
  console.log(`  Total frames: ${statsAfter.frameCount}`);
  console.log(`  Active frames: ${statsAfter.activeFrameCount}`);
  console.log(`  Note: Soft delete preserves data for recovery`);

  // -------------------------------------------------------------------------
  // Step 8: Timeline inspection
  // -------------------------------------------------------------------------
  console.log('\n--- Timeline Inspection ---\n');

  const allEntries = mem.timeline({ limit: 100, reverse: true });
  console.log(`Timeline entries (newest first): ${allEntries.length}`);

  for (const entry of allEntries.slice(0, 5)) {
    const date = new Date(entry.timestamp).toISOString();
    console.log(`  [${entry.frameId}] ${date}`);
    console.log(`       Preview: ${entry.preview.slice(0, 50)}...`);
    console.log(`       URI: ${entry.uri || 'N/A'}`);
  }

  // -------------------------------------------------------------------------
  // Step 9: Frame content inspection
  // -------------------------------------------------------------------------
  console.log('\n--- Frame Content Inspection ---\n');

  for (const frameId of frameIds.slice(0, 3)) {
    try {
      const frameInfo = mem.frame(frameId);
      const content = mem.view(frameId);

      console.log(`Frame ${frameId}:`);
      console.log(`  Title: ${frameInfo.title}`);
      console.log(`  Kind: ${frameInfo.kind}`);
      console.log(`  Size: ${frameInfo.payloadLength} bytes`);
      console.log(`  Content: ${content.slice(0, 50)}...`);
    } catch (error) {
      console.log(`Frame ${frameId}: ${(error as Error).message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 10: Maintenance workflow recommendation
  // -------------------------------------------------------------------------
  console.log('\n--- Recommended Maintenance Workflow ---\n');

  console.log('Daily/Weekly:');
  console.log('  1. Run verify(false) for quick health check');
  console.log('  2. Monitor stats() for growth patterns');
  console.log('  3. Check active vs total frame ratio');

  console.log('\nMonthly:');
  console.log('  1. Run verify(true) for deep integrity check');
  console.log('  2. Run doctor(path, false) to identify issues');
  console.log('  3. Review timeline for anomalies');

  console.log('\nBefore major operations:');
  console.log('  1. Create a backup copy');
  console.log('  2. Run doctor(path, true) to fix issues');
  console.log('  3. Verify backup integrity');

  console.log('\nExample maintenance script:');
  console.log(`
  import { open, doctor } from '@fpisani/memvid';
  import * as fs from 'fs';

  function maintainFile(path: string) {
    // 1. Create backup
    const backupPath = path + '.backup';
    fs.copyFileSync(path, backupPath);

    // 2. Quick verification
    const mem = open(path);
    if (!mem.verify(false)) {
      console.error('Quick verify failed!');
      mem.close();
      return false;
    }

    // 3. Check stats
    const stats = mem.stats();
    const deletionRatio = (stats.frameCount - stats.activeFrameCount) / stats.frameCount;
    if (deletionRatio > 0.5) {
      console.warn('High deletion ratio - consider compaction');
    }

    mem.close();

    // 4. Run doctor
    const result = doctor(path, true);
    if (result.issuesFound > 0) {
      console.log(\`Fixed \${result.issuesFixed}/\${result.issuesFound} issues\`);
    }

    return true;
  }
  `);

  // -------------------------------------------------------------------------
  // Final cleanup
  // -------------------------------------------------------------------------
  console.log('\n--- Final Statistics ---\n');

  const finalStats = mem.stats();
  console.log(`Final file state:`);
  console.log(`  Total frames: ${finalStats.frameCount}`);
  console.log(`  Active frames: ${finalStats.activeFrameCount}`);
  console.log(`  File size: ${finalStats.sizeBytes} bytes`);
  console.log(`  File healthy: ${mem.verify(true) ? 'YES' : 'NO'}`);

  mem.close();
  fs.unlinkSync(filePath);

  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
