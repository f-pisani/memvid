/**
 * Memory Cards Example
 *
 * This example demonstrates how to use structured memory cards
 * to store and retrieve facts about entities. Memory cards are
 * useful for AI agents that need to remember user preferences,
 * facts, and relationships across conversations.
 *
 * Key concepts:
 * - Entity: The subject (e.g., "user", "project", "company")
 * - Slot: The attribute (e.g., "employer", "location", "name")
 * - Value: The stored information
 * - Kind: The type of memory (fact, preference, event, etc.)
 *
 * Memory cards provide O(1) lookup for entity:slot pairs,
 * making them ideal for agent state management.
 */

import { create, open } from '../dist/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Helper to access native handle for memory card operations
// The high-level Memvid class wraps the native handle
function getHandle(mem: any): any {
  return mem.handle || mem;
}

async function main() {
  const filePath = path.join(os.tmpdir(), 'memory-example.mv2');

  // Clean up any existing file from previous runs
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  console.log('=== Memory Cards Example ===\n');

  // -------------------------------------------------------------------------
  // Step 1: Create a new memory file
  // -------------------------------------------------------------------------
  // The .mv2 extension is required for all memvid files.
  // This creates an empty memory store ready for data.
  const mem = create(filePath);
  const handle = getHandle(mem);

  // Enable text search index (optional but useful for searching memories)
  mem.enableLex();

  console.log('Created new memory file:', filePath);

  // -------------------------------------------------------------------------
  // Step 2: Store basic memory cards
  // -------------------------------------------------------------------------
  // Memory cards capture structured facts about entities.
  // Each card has an entity (who/what), slot (attribute), and value.

  console.log('\n--- Storing Memory Cards ---\n');

  // Store user preferences
  // These would typically be extracted from conversations
  handle.putMemoryCard({
    entity: 'user',
    slot: 'name',
    value: 'Alice Chen',
    kind: 'profile', // Kind helps categorize the memory
    confidence: 1.0, // High confidence - user stated directly
  });

  handle.putMemoryCard({
    entity: 'user',
    slot: 'employer',
    value: 'TechCorp Inc.',
    kind: 'fact',
    confidence: 0.95,
  });

  handle.putMemoryCard({
    entity: 'user',
    slot: 'preferred_language',
    value: 'TypeScript',
    kind: 'preference',
    confidence: 0.9, // Slightly lower - inferred from context
  });

  handle.putMemoryCard({
    entity: 'user',
    slot: 'timezone',
    value: 'America/New_York',
    kind: 'preference',
  });

  console.log('Stored 4 memory cards about the user');

  // -------------------------------------------------------------------------
  // Step 3: Store memories about other entities
  // -------------------------------------------------------------------------
  // Memory cards can track any entity - people, projects, topics, etc.

  // Store project information
  handle.putMemoryCard({
    entity: 'project:memvid',
    slot: 'status',
    value: 'active',
    kind: 'fact',
  });

  handle.putMemoryCard({
    entity: 'project:memvid',
    slot: 'priority',
    value: 'high',
    kind: 'fact',
  });

  handle.putMemoryCard({
    entity: 'project:memvid',
    slot: 'deadline',
    value: '2024-03-01',
    kind: 'event',
  });

  console.log('Stored 3 memory cards about the project');

  // -------------------------------------------------------------------------
  // Step 4: Batch insert memory cards
  // -------------------------------------------------------------------------
  // For efficiency, you can insert multiple cards at once.
  // This is useful when processing a document or conversation.

  const batchCards = [
    { entity: 'contact:bob', slot: 'role', value: 'Team Lead', kind: 'profile' },
    { entity: 'contact:bob', slot: 'email', value: 'bob@techcorp.com', kind: 'fact' },
    { entity: 'contact:carol', slot: 'role', value: 'Designer', kind: 'profile' },
    { entity: 'contact:carol', slot: 'expertise', value: 'UI/UX', kind: 'fact' },
  ];

  const cardIds = handle.putMemoryCards(batchCards);
  console.log(`Batch inserted ${cardIds.length} cards with IDs:`, cardIds);

  // Persist all changes to disk
  mem.commit();

  // -------------------------------------------------------------------------
  // Step 5: Query current memory state
  // -------------------------------------------------------------------------
  // The getCurrentMemory method returns the most recent value for an entity:slot.
  // This is crucial for agents that need to know the "current" state.

  console.log('\n--- Querying Memory State ---\n');

  // Get specific memory
  const userName = handle.getCurrentMemory('user', 'name');
  if (userName) {
    console.log('User name:', userName.value);
    console.log('  - Confidence:', userName.confidence);
    console.log('  - Kind:', userName.kind);
    console.log('  - Timestamp:', new Date(userName.timestamp).toISOString());
  }

  // -------------------------------------------------------------------------
  // Step 6: Use the state() convenience method
  // -------------------------------------------------------------------------
  // When you just need the value (not metadata), state() is simpler.
  // Returns null if the memory doesn't exist.

  console.log('\n--- Using state() for Quick Lookups ---\n');

  const employer = handle.state('user', 'employer');
  const language = handle.state('user', 'preferred_language');
  const nonExistent = handle.state('user', 'favorite_color');

  console.log('Employer:', employer); // "TechCorp Inc."
  console.log('Preferred language:', language); // "TypeScript"
  console.log('Favorite color:', nonExistent); // null (not set)

  // -------------------------------------------------------------------------
  // Step 7: Get all memories for an entity
  // -------------------------------------------------------------------------
  // Sometimes you need the full context about an entity.
  // This returns all slots and their values.

  console.log('\n--- Getting All Entity Memories ---\n');

  const userMemories = handle.getEntityMemories('user');
  console.log(`User has ${userMemories.length} memory cards:`);
  for (const card of userMemories) {
    console.log(`  - ${card.slot}: ${card.value} (${card.kind})`);
  }

  const projectMemories = handle.getEntityMemories('project:memvid');
  console.log(`\nProject has ${projectMemories.length} memory cards:`);
  for (const card of projectMemories) {
    console.log(`  - ${card.slot}: ${card.value}`);
  }

  // -------------------------------------------------------------------------
  // Step 8: Memory statistics
  // -------------------------------------------------------------------------
  // Get an overview of what's stored in the memory file.

  console.log('\n--- Memory Statistics ---\n');

  const stats = handle.memoriesStats();
  console.log('Total memory cards:', stats.cardCount);
  console.log('Unique entities:', stats.entityCount);

  // Alternative: just get the count
  const totalCards = handle.memoryCardCount();
  console.log('Card count (alternative):', totalCards);

  // -------------------------------------------------------------------------
  // Step 9: Updating memories (superseding old values)
  // -------------------------------------------------------------------------
  // When you add a new card with the same entity:slot, it supersedes the old value.
  // This is how memories "evolve" over time.

  console.log('\n--- Updating Memories ---\n');

  console.log('Current employer:', handle.state('user', 'employer'));

  // User changed jobs - add a new memory card
  handle.putMemoryCard({
    entity: 'user',
    slot: 'employer',
    value: 'NewStartup AI',
    kind: 'fact',
    confidence: 1.0,
  });

  console.log('Updated employer:', handle.state('user', 'employer'));

  // The old value is still in history, but getCurrentMemory returns the latest
  mem.commit();

  // -------------------------------------------------------------------------
  // Step 10: Source tracking
  // -------------------------------------------------------------------------
  // Memory cards can reference their source (e.g., a conversation frame).
  // This enables traceability - knowing where information came from.

  console.log('\n--- Source Tracking ---\n');

  // First, store a document that contains the information
  const frameId = mem.put(
    Buffer.from('Meeting notes: Alice mentioned she prefers dark mode for all apps.'),
    { title: 'Meeting Notes 2024-01-15', uri: 'doc://meetings/2024-01-15' }
  );
  mem.commit();

  // Then create a memory card referencing that document
  handle.putMemoryCard({
    entity: 'user',
    slot: 'theme_preference',
    value: 'dark mode',
    kind: 'preference',
    confidence: 0.85,
    sourceFrameId: frameId,
    sourceUri: 'doc://meetings/2024-01-15',
  });
  mem.commit();

  // When retrieving, you can see where the information came from
  const themeCard = handle.getCurrentMemory('user', 'theme_preference');
  if (themeCard) {
    console.log('Theme preference:', themeCard.value);
    console.log('  - Source frame ID:', themeCard.sourceFrameId);
    console.log('  - Source URI:', themeCard.sourceUri);
  }

  // -------------------------------------------------------------------------
  // Step 11: Reopen and verify persistence
  // -------------------------------------------------------------------------
  // Memory cards persist across sessions.

  console.log('\n--- Verifying Persistence ---\n');

  mem.close();

  const reopened = open(filePath);
  const reopenedHandle = getHandle(reopened);

  const persistedName = reopenedHandle.state('user', 'name');
  const persistedEmployer = reopenedHandle.state('user', 'employer');

  console.log('After reopening file:');
  console.log('  - Name:', persistedName);
  console.log('  - Employer:', persistedEmployer);

  // Final stats
  const finalStats = reopenedHandle.memoriesStats();
  console.log('\nFinal memory state:');
  console.log('  - Total cards:', finalStats.cardCount);
  console.log('  - Total entities:', finalStats.entityCount);

  reopened.close();

  // Clean up
  fs.unlinkSync(filePath);
  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
