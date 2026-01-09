/**
 * Error types for memvid-node
 */

/** Base error class for all memvid errors */
export class MemvidError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MemvidError';
    this.code = code;
    Object.setPrototypeOf(this, MemvidError.prototype);
  }
}

/** Lex (text) index not enabled */
export class LexNotEnabledError extends MemvidError {
  constructor() {
    super('LEX_NOT_ENABLED', 'Lexical search index not enabled. Call enableLex() first.');
  }
}

/** Vec (vector) index not enabled */
export class VecNotEnabledError extends MemvidError {
  constructor() {
    super('VEC_NOT_ENABLED', 'Vector search index not enabled. Call enableVec() first.');
  }
}

/** Vector dimension mismatch */
export class VecDimensionMismatchError extends MemvidError {
  expected: number;
  got: number;

  constructor(expected: number, got: number) {
    super('VEC_DIM_MISMATCH', `Expected ${expected} embedding dimensions, got ${got}`);
    this.expected = expected;
    this.got = got;
  }
}

/** Frame not found */
export class FrameNotFoundError extends MemvidError {
  frameId: number;

  constructor(frameId: number) {
    super('FRAME_NOT_FOUND', `Frame ${frameId} was not found`);
    this.frameId = frameId;
  }
}

/** Handle is closed */
export class HandleClosedError extends MemvidError {
  constructor() {
    super('HANDLE_CLOSED', 'Handle is closed');
  }
}

/** Invalid path */
export class InvalidPathError extends MemvidError {
  constructor(message: string) {
    super('INVALID_PATH', message);
  }
}

/** File not found */
export class FileNotFoundError extends MemvidError {
  path: string;

  constructor(path: string) {
    super('FILE_NOT_FOUND', `File not found: ${path}`);
    this.path = path;
  }
}

/** Invalid file format */
export class InvalidFileError extends MemvidError {
  constructor(message: string) {
    super('INVALID_FILE', message);
  }
}

/** File is corrupted */
export class CorruptedFileError extends MemvidError {
  constructor(message: string) {
    super('CORRUPTED_FILE', message);
  }
}

/** Embedding provider error */
export class EmbeddingError extends MemvidError {
  provider: string;

  constructor(provider: string, message: string) {
    super('EMBEDDING_ERROR', `${provider}: ${message}`);
    this.provider = provider;
  }
}

/** Error code regex pattern: [CODE] message */
const ERROR_CODE_PATTERN = /^\[([A-Z_]+)\]\s*(.*)$/;

/** Parse NAPI error message and return appropriate error class */
export function parseNapiError(error: Error): MemvidError {
  const message = error.message;

  // Try to extract structured error code
  const codeMatch = message.match(ERROR_CODE_PATTERN);
  const code = codeMatch ? codeMatch[1] : null;
  const cleanMessage = codeMatch ? codeMatch[2] : message;

  // Handle by error code first (most reliable)
  if (code) {
    switch (code) {
      case 'LEX_NOT_ENABLED':
        return new LexNotEnabledError();
      case 'VEC_NOT_ENABLED':
      case 'FEATURE_UNAVAILABLE':
        return new VecNotEnabledError();
      case 'VEC_DIMENSION_MISMATCH': {
        const dimMatch = cleanMessage.match(/expected (\d+).*got (\d+)/i);
        if (dimMatch) {
          return new VecDimensionMismatchError(parseInt(dimMatch[1]), parseInt(dimMatch[2]));
        }
        return new MemvidError(code, cleanMessage);
      }
      case 'FRAME_NOT_FOUND': {
        const frameMatch = cleanMessage.match(/Frame (\d+)/);
        if (frameMatch) {
          return new FrameNotFoundError(parseInt(frameMatch[1]));
        }
        return new MemvidError(code, cleanMessage);
      }
      case 'IO_ERROR':
        if (cleanMessage.includes('No such file')) {
          return new FileNotFoundError(cleanMessage);
        }
        return new MemvidError(code, cleanMessage);
      case 'INVALID_HEADER':
      case 'INVALID_TOC':
        return new InvalidFileError(cleanMessage);
      case 'CHECKSUM_MISMATCH':
      case 'WAL_CORRUPTION':
      case 'MANIFEST_WAL_CORRUPTED':
        return new CorruptedFileError(cleanMessage);
      case 'PANIC':
        return new MemvidError('PANIC', cleanMessage);
      default:
        return new MemvidError(code, cleanMessage);
    }
  }

  // Fallback to string matching for non-structured errors (e.g., from TypeScript layer)
  if (message.includes('Handle is closed') || message.includes('handle invalidated')) {
    return new HandleClosedError();
  }

  if (message.includes('Path traversal') || message.includes('.mv2 extension') || message.includes('null bytes')) {
    return new InvalidPathError(message);
  }

  if (message.includes('Lex not enabled') || message.includes('lex index')) {
    return new LexNotEnabledError();
  }

  if (message.includes('Vec not enabled') || message.includes('vec index')) {
    return new VecNotEnabledError();
  }

  if (message.includes('dimension') && message.includes('mismatch')) {
    const match = message.match(/expected (\d+).*got (\d+)/i);
    if (match) {
      return new VecDimensionMismatchError(parseInt(match[1]), parseInt(match[2]));
    }
  }

  if (message.includes('Frame') && message.includes('not found')) {
    const match = message.match(/Frame (\d+)/);
    if (match) {
      return new FrameNotFoundError(parseInt(match[1]));
    }
  }

  if (message.includes('not found') && message.includes('file')) {
    return new FileNotFoundError(message);
  }

  if (message.includes('invalid') || message.includes('Invalid')) {
    return new InvalidFileError(message);
  }

  if (message.includes('corrupt') || message.includes('Corrupt')) {
    return new CorruptedFileError(message);
  }

  // Generic error
  return new MemvidError('UNKNOWN', message);
}
