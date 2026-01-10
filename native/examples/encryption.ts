/**
 * Encryption Example
 *
 * This example demonstrates how to secure memvid files with
 * password-based encryption using the lock() and unlock() functions.
 *
 * Key concepts:
 * - lock(): Encrypt a .mv2 file to .mv2e format
 * - unlock(): Decrypt a .mv2e file back to .mv2
 * - Encryption uses AES-256-GCM with password-derived keys
 *
 * Security notes:
 * - Use strong passwords (12+ characters, mixed case, numbers, symbols)
 * - Store passwords securely (env vars, secrets manager)
 * - The .mv2e file cannot be opened directly - must unlock first
 * - Original .mv2 file is preserved (not deleted)
 *
 * File flow:
 *   data.mv2 --[lock]--> data.mv2e --[unlock]--> data.mv2
 */

import { create, open, lock, unlock, version } from '../dist/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function main() {
  const basePath = path.join(os.tmpdir(), 'encryption-example');
  const originalFile = basePath + '.mv2';
  const encryptedFile = basePath + '.mv2e';
  const decryptedFile = basePath + '_decrypted.mv2';

  // Clean up any existing files
  for (const file of [originalFile, encryptedFile, decryptedFile]) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }

  console.log('=== Encryption Example ===\n');
  console.log('Memvid version: ' + version() + '\n');

  // -------------------------------------------------------------------------
  // Step 1: Create a file with sensitive data
  // -------------------------------------------------------------------------
  console.log('--- Creating File with Sensitive Data ---\n');

  const mem = create(originalFile);
  mem.enableLex();

  // Store some sensitive data
  const sensitiveData = [
    { content: 'API_KEY=sk-1234567890abcdef', title: 'API Credentials' },
    { content: 'DB_PASSWORD=super_secret_password', title: 'Database Config' },
    { content: 'User SSN: 123-45-6789', title: 'User PII' },
    { content: 'Credit Card: 4111-1111-1111-1111', title: 'Payment Info' },
  ];

  for (const doc of sensitiveData) {
    mem.put(Buffer.from(doc.content), {
      title: doc.title,
      kind: 'sensitive',
      labels: ['pii', 'encrypted'],
    });
  }

  mem.commit();
  mem.close();

  const originalSize = fs.statSync(originalFile).size;
  console.log('Created: ' + originalFile);
  console.log('  Size: ' + originalSize + ' bytes');
  console.log('  Contains: ' + sensitiveData.length + ' sensitive documents');

  // -------------------------------------------------------------------------
  // Step 2: Lock (encrypt) the file
  // -------------------------------------------------------------------------
  console.log('\n--- Encrypting File ---\n');

  // In production, use a strong password from environment or secrets manager
  // NEVER hardcode passwords in production code!
  const password = 'MyStr0ng!P@ssw0rd#2024';

  console.log('Encryption parameters:');
  console.log('  - Algorithm: AES-256-GCM');
  console.log('  - Key derivation: Argon2id');
  console.log('  - Password length: ' + password.length + ' characters');

  try {
    // lock() creates an encrypted copy with .mv2e extension
    const encryptedPath = lock(originalFile, password);

    console.log('\nEncrypted file created: ' + encryptedPath);

    if (fs.existsSync(encryptedPath)) {
      const encryptedSize = fs.statSync(encryptedPath).size;
      console.log('  Size: ' + encryptedSize + ' bytes');
      console.log('  Overhead: ' + (encryptedSize - originalSize) + ' bytes (encryption metadata)');
    }

    // -------------------------------------------------------------------------
    // Step 3: Demonstrate that encrypted file cannot be opened directly
    // -------------------------------------------------------------------------
    console.log('\n--- Verifying Encryption ---\n');

    console.log('Attempting to open encrypted file directly...');
    try {
      // This should fail - encrypted files cannot be opened as regular .mv2
      open(encryptedPath);
      console.log('  ERROR: Should not be able to open encrypted file!');
    } catch (error) {
      console.log('  Correctly rejected: Cannot open encrypted file directly');
      console.log('  Error: ' + (error as Error).message.slice(0, 50) + '...');
    }

    // -------------------------------------------------------------------------
    // Step 4: Unlock (decrypt) the file
    // -------------------------------------------------------------------------
    console.log('\n--- Decrypting File ---\n');

    // unlock() creates a decrypted copy with .mv2 extension
    const decryptedPath = unlock(encryptedPath, password);

    console.log('Decrypted file created: ' + decryptedPath);

    if (fs.existsSync(decryptedPath)) {
      const decryptedSize = fs.statSync(decryptedPath).size;
      console.log('  Size: ' + decryptedSize + ' bytes');
      console.log('  Matches original: ' + (decryptedSize === originalSize));
    }

    // -------------------------------------------------------------------------
    // Step 5: Verify decrypted content
    // -------------------------------------------------------------------------
    console.log('\n--- Verifying Decrypted Content ---\n');

    const decryptedMem = open(decryptedPath);
    const stats = decryptedMem.stats();

    console.log('Decrypted file stats:');
    console.log('  Frame count: ' + stats.frameCount);
    console.log('  Has lex index: ' + stats.hasLexIndex);

    // Verify all documents are intact
    const results = decryptedMem.find('sensitive', 10);
    console.log('\nSearching decrypted content:');
    console.log('  Query: "sensitive"');
    console.log('  Results: ' + results.totalHits);

    // Check timeline
    const timeline = decryptedMem.timeline({ limit: 10 });
    console.log('\nTimeline entries: ' + timeline.length);
    for (const entry of timeline) {
      console.log('  [' + entry.frameId + '] ' + entry.preview.slice(0, 40) + '...');
    }

    decryptedMem.close();

    // -------------------------------------------------------------------------
    // Step 6: Wrong password handling
    // -------------------------------------------------------------------------
    console.log('\n--- Wrong Password Handling ---\n');

    const wrongPassword = 'wrong_password';
    console.log('Attempting to decrypt with wrong password...');

    try {
      unlock(encryptedPath, wrongPassword);
      console.log('  ERROR: Should have failed with wrong password!');
    } catch (error) {
      console.log('  Correctly rejected: Invalid password');
      console.log('  Error type: ' + ((error as Error).message.includes('decrypt') ? 'Decryption failure' : 'Authentication failure'));
    }

    // -------------------------------------------------------------------------
    // Step 7: Security best practices
    // -------------------------------------------------------------------------
    console.log('\n--- Security Best Practices ---\n');

    console.log('Password requirements:');
    console.log('  - Minimum 12 characters');
    console.log('  - Mix of uppercase, lowercase, numbers, symbols');
    console.log('  - Avoid dictionary words');
    console.log('  - Use a password manager');

    console.log('\nPassword storage:');
    console.log('  - Use environment variables: process.env.MEMVID_PASSWORD');
    console.log('  - Use secrets manager (AWS Secrets Manager, HashiCorp Vault)');
    console.log('  - Never commit passwords to version control');
    console.log('  - Never log passwords');

    console.log('\nFile handling:');
    console.log('  - Delete original .mv2 after confirming encryption');
    console.log('  - Store .mv2e files in secure locations');
    console.log('  - Use filesystem permissions to restrict access');
    console.log('  - Consider full-disk encryption as additional layer');

    console.log('\nExample secure workflow:');
    console.log('');
    console.log('    // Load password from environment');
    console.log('    const password = process.env.MEMVID_PASSWORD;');
    console.log('    if (!password) {');
    console.log("      throw new Error('MEMVID_PASSWORD not set');");
    console.log('    }');
    console.log('');
    console.log('    // Encrypt the file');
    console.log("    const encryptedPath = lock('./data.mv2', password);");
    console.log('');
    console.log('    // Securely delete original');
    console.log("    fs.unlinkSync('./data.mv2');");
    console.log('');
    console.log('    // Later: decrypt for use');
    console.log('    const decryptedPath = unlock(encryptedPath, password);');
    console.log('    const mem = open(decryptedPath);');
    console.log('    // ... use the data ...');
    console.log('    mem.close();');
    console.log('');
    console.log('    // Clean up decrypted copy when done');
    console.log('    fs.unlinkSync(decryptedPath);');

    // Clean up encrypted file for this example
    if (fs.existsSync(encryptedPath)) {
      fs.unlinkSync(encryptedPath);
    }
  } catch (error) {
    // Handle encryption feature not available
    if ((error as Error).message.includes('FEATURE_UNAVAILABLE')) {
      console.log('\nNote: Encryption feature is not enabled in this build.');
      console.log('The encryption feature requires the "encryption" feature flag.');
      console.log('Enable it with: cargo build --features encryption');
    } else {
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  console.log('\n--- Cleanup ---\n');

  for (const file of [originalFile, encryptedFile, decryptedFile]) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log('Deleted: ' + file);
    }
  }

  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
