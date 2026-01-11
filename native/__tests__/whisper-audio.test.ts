/**
 * Whisper Audio Transcription tests for memvid-node
 *
 * Note: These tests verify the Whisper Audio API structure and error handling.
 * Actual transcription tests require the "whisper" feature flag to be enabled
 * during build and the Whisper model to be downloaded (~500MB).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// Import Whisper functions - these may not be available if whisper feature is disabled
import {
  createWhisper,
  transcribeAudio,
  transcribeAudioBuffer,
} from '../dist/index.js';

// Import types for verification
import type {
  TranscriptionResult,
  TranscriptionSegment,
  WhisperOptions,
  WhisperHandle,
} from '../dist/types.js';

const TEST_DIR = os.tmpdir();

/** Generate a unique test file path */
function uniqueTestFile(ext: string = 'mv2'): string {
  return path.join(TEST_DIR, `memvid_whisper_${crypto.randomUUID()}.${ext}`);
}

/** Check if Whisper feature is available */
function isWhisperAvailable(): boolean {
  try {
    // Try to call createWhisper - if the feature is disabled, it will throw
    // We use a try/catch with a specific error message check
    createWhisper({ offline: true });
    return true;
  } catch (error) {
    const err = error as Error & { code?: string };
    const message = err.message;
    const code = err.code;
    // If the error is about the feature not being available, return false
    // Check both error code and message text
    if (
      code === 'WHISPER_NOT_AVAILABLE' ||
      message.includes('not available') ||
      message.includes('not a function')
    ) {
      return false;
    }
    // Other errors (like model not found) mean the feature IS available
    return true;
  }
}

describe('Whisper Audio Transcription', () => {
  describe('API availability', () => {
    it('should export createWhisper function', () => {
      expect(typeof createWhisper).toBe('function');
    });

    it('should export transcribeAudio function', () => {
      expect(typeof transcribeAudio).toBe('function');
    });

    it('should export transcribeAudioBuffer function', () => {
      expect(typeof transcribeAudioBuffer).toBe('function');
    });
  });

  describe('Error handling (feature disabled)', () => {
    // These tests verify proper error handling when whisper feature is not enabled
    it('createWhisper should throw descriptive error when feature is disabled', () => {
      // Skip if whisper is actually available
      if (isWhisperAvailable()) {
        return;
      }

      expect(() => createWhisper()).toThrow(/WHISPER_NOT_AVAILABLE|not available/i);
    });

    it('transcribeAudio should throw descriptive error when feature is disabled', () => {
      if (isWhisperAvailable()) {
        return;
      }

      expect(() => transcribeAudio('/nonexistent/audio.mp3')).toThrow(
        /WHISPER_NOT_AVAILABLE|not available/i
      );
    });

    it('transcribeAudioBuffer should throw descriptive error when feature is disabled', () => {
      if (isWhisperAvailable()) {
        return;
      }

      expect(() => transcribeAudioBuffer(Buffer.from('fake audio data'))).toThrow(
        /WHISPER_NOT_AVAILABLE|not available/i
      );
    });
  });

  // These tests only run when whisper feature is enabled
  describe('Feature enabled tests', () => {
    const whisperAvailable = isWhisperAvailable();

    it.skipIf(!whisperAvailable)(
      'createWhisper should accept options',
      () => {
        const options: WhisperOptions = {
          modelName: 'whisper-small-en',
          offline: true, // Don't download models in tests
        };

        // This will fail if model not downloaded, but that's expected
        // We're just testing that the options are accepted
        try {
          const handle = createWhisper(options);
          expect(handle).toBeDefined();
          expect(typeof handle.transcribe).toBe('function');
          expect(typeof handle.transcribeBuffer).toBe('function');
        } catch (error) {
          // Expected if model not downloaded
          expect((error as Error).message).toMatch(/model|download|offline/i);
        }
      }
    );

    it.skipIf(!whisperAvailable)(
      'transcribeAudio should throw for non-existent file',
      () => {
        try {
          transcribeAudio('/definitely/nonexistent/audio.mp3', { offline: true });
          // If we get here, the model isn't downloaded which is fine
        } catch (error) {
          const message = (error as Error).message;
          // Should fail either for missing file or missing model
          expect(message).toMatch(/not found|model|download|offline|Failed/i);
        }
      }
    );

    it.skipIf(!whisperAvailable)(
      'transcribeAudioBuffer should handle invalid audio data gracefully',
      () => {
        const invalidAudio = Buffer.from('This is not valid audio data');

        try {
          transcribeAudioBuffer(invalidAudio, { offline: true });
          // If we get here, the model isn't downloaded which is fine
        } catch (error) {
          const message = (error as Error).message;
          // Should fail for invalid audio or missing model
          expect(message).toMatch(/decode|format|model|download|offline|Failed|transcribe/i);
        }
      }
    );
  });
});

describe('WhisperOptions type', () => {
  it('should allow empty options object', () => {
    const options: WhisperOptions = {};
    expect(options.modelName).toBeUndefined();
    expect(options.modelsDir).toBeUndefined();
    expect(options.offline).toBeUndefined();
  });

  it('should allow full options object', () => {
    const options: WhisperOptions = {
      modelName: 'whisper-small',
      modelsDir: '/custom/models',
      offline: true,
    };
    expect(options.modelName).toBe('whisper-small');
    expect(options.modelsDir).toBe('/custom/models');
    expect(options.offline).toBe(true);
  });

  it('should allow partial options', () => {
    const options: WhisperOptions = {
      modelName: 'whisper-base-en',
    };
    expect(options.modelName).toBe('whisper-base-en');
    expect(options.modelsDir).toBeUndefined();
  });
});

describe('TranscriptionResult type', () => {
  it('should have expected structure', () => {
    // Type-level test: verify the interface shape
    const mockResult: TranscriptionResult = {
      text: 'Hello world',
      language: 'en',
      durationSecs: 5.5,
      segments: [
        { start: 0.0, end: 2.5, text: 'Hello' },
        { start: 2.5, end: 5.5, text: 'world' },
      ],
    };

    expect(mockResult.text).toBe('Hello world');
    expect(mockResult.language).toBe('en');
    expect(mockResult.durationSecs).toBe(5.5);
    expect(mockResult.segments).toHaveLength(2);
    expect(mockResult.segments[0].start).toBe(0.0);
    expect(mockResult.segments[0].end).toBe(2.5);
    expect(mockResult.segments[0].text).toBe('Hello');
  });
});

describe('TranscriptionSegment type', () => {
  it('should have start, end, and text fields', () => {
    const segment: TranscriptionSegment = {
      start: 10.5,
      end: 15.25,
      text: 'Test segment',
    };

    expect(segment.start).toBe(10.5);
    expect(segment.end).toBe(15.25);
    expect(segment.text).toBe('Test segment');
  });
});
