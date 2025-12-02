/**
 * Keystore File Loader
 *
 * Handles loading and parsing keystore configuration files.
 */
import { createLogger } from '@aztec/foundation/log';

import { readFileSync, readdirSync, statSync } from 'fs';
import { extname, join } from 'path';

import { keystoreSchema } from './schemas.js';
import type { EthAccounts, KeyStore } from './types.js';

const logger = createLogger('node-keystore:loader');

/**
 * Sensitive field names that should be redacted from error messages
 */
const SENSITIVE_FIELDS = ['password', 'certPass', 'mnemonic'];

/**
 * Sanitizes sensitive fields from an object or string representation.
 * Recursively removes or redacts sensitive fields to prevent them from appearing in logs.
 */
function sanitizeErrorData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Try to parse as JSON and sanitize, otherwise return as-is
    try {
      const parsed = JSON.parse(data);
      return JSON.stringify(sanitizeErrorData(parsed));
    } catch {
      // Not JSON, check if it looks like a private key (0x followed by 64 hex chars)
      if (/^0x[0-9a-fA-F]{64}$/i.test(data)) {
        return '[REDACTED_PRIVATE_KEY]';
      }
      return data;
    }
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeErrorData(item));
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/i.test(value) && key !== 'feeRecipient') {
        // Redact private keys
        sanitized[key] = '[REDACTED_PRIVATE_KEY]';
      } else {
        sanitized[key] = sanitizeErrorData(value);
      }
    }
    return sanitized;
  }

  return data;
}

/**
 * Sanitizes a Zod error message to remove sensitive data.
 * Handles both the error message string and any received data in the error.
 * @param error - The Zod error object
 * @param receivedData - Optional parsed data that was being validated (to show what was received)
 */
function sanitizeZodError(error: unknown, receivedData?: unknown): string {
  if (!error || typeof error !== 'object') {
    const errorStr = String(error);
    // Check if the string itself contains JSON with sensitive data
    return sanitizeStringForSensitiveData(errorStr);
  }

  const zodError = error as { issues?: unknown[]; received?: unknown; message?: string };
  const issues = zodError.issues ?? [];

  // Build error message from issues
  let message =
    issues
      .map((e: any) => {
        const path = Array.isArray(e.path) ? e.path.join('.') : String(e.path ?? 'root');
        // Sanitize the issue message itself in case it contains sensitive data
        const sanitizedMsg = sanitizeStringForSensitiveData(e.message || '');
        return `${sanitizedMsg} (${path})`;
      })
      .join('. ') || 'Schema validation error';

  // Include received data if available (either from error object or passed parameter)
  const dataToInclude = zodError.received !== undefined ? zodError.received : receivedData;
  if (dataToInclude !== undefined) {
    const sanitized = sanitizeErrorData(dataToInclude);
    // Only append received data if it's not too large (avoid huge error messages)
    // For strict validation errors, show the relevant part of the object
    const sanitizedStr = JSON.stringify(sanitized);
    if (sanitizedStr.length < 1000) {
      message = `${message}. Received: ${sanitizedStr}`;
    } else {
      // If too large, try to extract just the problematic path
      const firstIssue = issues[0] as any;
      if (firstIssue?.path && Array.isArray(firstIssue.path)) {
        let relevantData: unknown = dataToInclude;
        for (const key of firstIssue.path) {
          if (relevantData && typeof relevantData === 'object' && key in relevantData) {
            relevantData = (relevantData as Record<string, unknown>)[key];
          } else {
            relevantData = undefined;
            break;
          }
        }
        if (relevantData !== undefined) {
          const sanitizedRelevant = sanitizeErrorData(relevantData);
          const relevantStr = JSON.stringify(sanitizedRelevant);
          if (relevantStr.length < 500) {
            message = `${message}. Received at ${firstIssue.path.join('.')}: ${relevantStr}`;
          }
        }
      }
    }
  }

  // If no issues were found but there's a message, use and sanitize it
  if (issues.length === 0 && zodError.message) {
    message = sanitizeStringForSensitiveData(zodError.message);
  } else if (zodError.message) {
    // If we have both issues and a message, sanitize the message and append it
    const sanitizedMsg = sanitizeStringForSensitiveData(zodError.message);
    if (sanitizedMsg !== message) {
      message = `${message}. ${sanitizedMsg}`;
    }
  }

  // Final sanitization pass to catch any remaining sensitive data
  return sanitizeStringForSensitiveData(message);
}

/**
 * Sanitizes a string that might contain JSON with sensitive data.
 * Attempts to parse and sanitize JSON, otherwise redacts patterns that look like sensitive values.
 */
function sanitizeStringForSensitiveData(str: string): string {
  let sanitized = str;

  // First, try to redact sensitive field values directly using regex
  // This handles both complete and incomplete JSON, and various formatting
  for (const field of SENSITIVE_FIELDS) {
    // Match patterns like: "password":"value" or "password": "value" or "password":"value", etc.
    // Handle both quoted and unquoted values, and incomplete JSON
    const fieldPattern = new RegExp(`("${field}"\\s*:\\s*")[^",}\\]]*`, 'gi');
    sanitized = sanitized.replace(fieldPattern, '$1[REDACTED]');

    // Also handle single quotes and unquoted keys
    const fieldPatternAlt = new RegExp(`(['"]${field}['"]\\s*:\\s*['"])[^'",}\\]]*`, 'gi');
    sanitized = sanitized.replace(fieldPatternAlt, '$1[REDACTED]');
  }

  // Try to find and sanitize complete JSON objects
  // Look for JSON-like structures (may be incomplete)
  const jsonLikePattern = /\{[^{}]*"(?:password|certPass|mnemonic)"[^{}]*\}/gi;
  sanitized = sanitized.replace(jsonLikePattern, match => {
    try {
      // Try to parse as complete JSON
      const parsed = JSON.parse(match);
      const sanitizedObj = sanitizeErrorData(parsed);
      return JSON.stringify(sanitizedObj);
    } catch {
      // If parsing fails, the regex replacement above should have already handled it
      return match;
    }
  });

  // Redact private keys (0x followed by 64 hex chars) that might appear in the string
  sanitized = sanitized.replace(/0x[0-9a-fA-F]{64}/gi, '[REDACTED_PRIVATE_KEY]');

  return sanitized;
}

/**
 * Error thrown when keystore loading fails
 */
export class KeyStoreLoadError extends Error {
  constructor(
    message: string,
    public filePath: string,
    public override cause?: Error,
  ) {
    super(`Failed to load keystore from ${filePath}: ${message}`);
    this.name = 'KeyStoreLoadError';
  }
}

/**
 * Loads and validates a single keystore JSON file.
 *
 * @param filePath Absolute or relative path to a keystore JSON file.
 * @returns Parsed keystore object adhering to the schema.
 * @throws KeyStoreLoadError When JSON is invalid, schema validation fails, or other IO/parse errors occur.
 */
export function loadKeystoreFile(filePath: string): KeyStore {
  try {
    const content = readFileSync(filePath, 'utf-8');
    let parsedData: unknown;

    try {
      parsedData = JSON.parse(content);
    } catch (parseError) {
      if (parseError instanceof SyntaxError) {
        throw new KeyStoreLoadError('Invalid JSON format', filePath, parseError);
      }
      throw parseError;
    }

    // Validate with Zod schema (following Aztec patterns)
    return keystoreSchema.parse(parsedData);
  } catch (error) {
    if (error instanceof KeyStoreLoadError) {
      throw error;
    }
    if (error && typeof error === 'object' && 'issues' in error) {
      // Get the parsed data from the error if available, or try to parse the file again
      let receivedData: unknown = undefined;
      try {
        const content = readFileSync(filePath, 'utf-8');
        receivedData = JSON.parse(content);
      } catch {
        // If we can't read/parse, that's okay - we'll just use the error message
      }

      const sanitizedMessage = sanitizeZodError(error, receivedData);
      throw new KeyStoreLoadError(`Schema validation failed: ${sanitizedMessage}`, filePath, error as unknown as Error);
    }
    // Sanitize unexpected errors as well in case they contain sensitive data
    const errorMessage = typeof error === 'object' && error !== null ? sanitizeZodError(error) : String(error);
    throw new KeyStoreLoadError(`Unexpected error: ${errorMessage}`, filePath, error as Error);
  }
}

/**
 * Loads keystore files from a directory (only .json files).
 *
 * @param dirPath Absolute or relative path to a directory containing keystore files.
 * @returns Array of parsed keystores loaded from all .json files in the directory.
 * @throws KeyStoreLoadError When the directory can't be read or contains no valid keystore files.
 */
export function loadKeystoreDirectory(dirPath: string): KeyStore[] {
  try {
    const files = readdirSync(dirPath);
    const keystores: KeyStore[] = [];

    for (const file of files) {
      // Only process .json files
      if (extname(file).toLowerCase() !== '.json') {
        continue;
      }

      const filePath = join(dirPath, file);
      try {
        const keystore = loadKeystoreFile(filePath);
        keystores.push(keystore);
      } catch (error) {
        // Re-throw with directory context
        if (error instanceof KeyStoreLoadError) {
          throw error;
        }
        throw new KeyStoreLoadError(`Failed to load file ${file}`, filePath, error as Error);
      }
    }

    if (keystores.length === 0) {
      throw new KeyStoreLoadError('No valid keystore files found', dirPath);
    }

    return keystores;
  } catch (error) {
    if (error instanceof KeyStoreLoadError) {
      throw error;
    }
    throw new KeyStoreLoadError(`Failed to read directory`, dirPath, error as Error);
  }
}

/**
 * Loads keystore(s) from a path (file or directory).
 *
 * If a file is provided, loads a single keystore. If a directory is provided,
 * loads all keystore files within that directory.
 *
 * @param path File or directory path.
 * @returns Array of parsed keystores.
 * @throws KeyStoreLoadError When the path is invalid or cannot be accessed.
 */
export function loadKeystores(path: string): KeyStore[] {
  try {
    const stats = statSync(path);

    if (stats.isFile()) {
      return [loadKeystoreFile(path)];
    } else if (stats.isDirectory()) {
      return loadKeystoreDirectory(path);
    } else {
      throw new KeyStoreLoadError('Path is neither a file nor directory', path);
    }
  } catch (error) {
    if (error instanceof KeyStoreLoadError) {
      throw error;
    }

    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      throw new KeyStoreLoadError('File or directory not found', path, error as Error);
    }

    throw new KeyStoreLoadError(`Failed to access path: ${err?.code ?? 'UNKNOWN'}`, path, error as Error);
  }
}

/**
 * Loads keystore(s) from multiple paths (comma-separated string or array).
 *
 * @param paths Comma-separated string or array of file/directory paths.
 * @returns Flattened array of all parsed keystores from all paths.
 * @throws KeyStoreLoadError When any path fails to load; includes context for which path list was used.
 */
export function loadMultipleKeystores(paths: string | string[]): KeyStore[] {
  const pathArray = typeof paths === 'string' ? paths.split(',').map(p => p.trim()) : paths;
  const allKeystores: KeyStore[] = [];

  for (const path of pathArray) {
    if (!path) {
      continue;
    } // Skip empty paths

    try {
      const keystores = loadKeystores(path);
      allKeystores.push(...keystores);
    } catch (error) {
      // Add context about which path failed
      if (error instanceof KeyStoreLoadError) {
        throw new KeyStoreLoadError(
          `${error.message} (from path list: ${pathArray.join(', ')})`,
          error.filePath,
          error.cause,
        );
      }
      throw error;
    }
  }

  if (allKeystores.length === 0) {
    throw new KeyStoreLoadError('No keystore files found in any of the provided paths', pathArray.join(', '));
  }

  return allKeystores;
}

/**
 * Merges multiple keystores into a single configuration.
 *
 * - Concatenates validator arrays and enforces unique attester addresses by simple structural keys
 * - Accumulates all slasher accounts across inputs
 * - Applies last-one-wins semantics for file-level remote signer defaults
 * - Requires at most one prover configuration across inputs
 *
 * Note: Full duplicate detection (e.g., after resolving JSON V3 or mnemonics) is
 * performed downstream by the validator client.
 *
 * @param keystores Array of keystores to merge.
 * @returns A merged keystore object.
 * @throws Error When keystore list is empty.
 * @throws KeyStoreLoadError When duplicate attester keys are found or multiple prover configs exist.
 */
export function mergeKeystores(keystores: KeyStore[]): KeyStore {
  if (keystores.length === 0) {
    throw new Error('Cannot merge empty keystore list');
  }

  if (keystores.length === 1) {
    return keystores[0];
  }

  // Track attester addresses to prevent duplicates
  const attesterAddresses = new Set<string>();

  const merged: KeyStore = {
    schemaVersion: 1,
    validators: [],
    slasher: undefined,
    remoteSigner: undefined,
    prover: undefined,
  };

  for (let i = 0; i < keystores.length; i++) {
    const keystore = keystores[i];

    // Merge validators
    if (keystore.validators) {
      for (const validator of keystore.validators) {
        // Check for duplicate attester addresses
        const attesterKeys = extractAttesterKeys(validator.attester);
        for (const key of attesterKeys) {
          if (attesterAddresses.has(key)) {
            // Sanitize the key before including it in the error message to prevent sensitive data leakage
            const sanitizedKey = sanitizeStringForSensitiveData(key);
            throw new KeyStoreLoadError(
              `Duplicate attester address ${sanitizedKey} found across keystore files`,
              `keystores[${i}].validators`,
            );
          }
          attesterAddresses.add(key);
        }
      }
      merged.validators!.push(...keystore.validators);
    }

    // Merge slasher (accumulate all)
    if (keystore.slasher) {
      if (!merged.slasher) {
        merged.slasher = keystore.slasher;
      } else {
        const toArray = (accounts: EthAccounts): unknown[] => (Array.isArray(accounts) ? accounts : [accounts]);
        const combined = [...toArray(merged.slasher), ...toArray(keystore.slasher)];
        // Cast is safe at runtime: consumer handles arrays with mixed account configs
        merged.slasher = combined as unknown as EthAccounts;
      }
    }

    // Merge remote signer (last one wins, but warn about conflicts)
    if (keystore.remoteSigner) {
      if (merged.remoteSigner) {
        logger.warn('Multiple default remote signer configurations found, using the last one');
      }
      merged.remoteSigner = keystore.remoteSigner;
    }

    // Merge prover (error if multiple)
    if (keystore.prover) {
      if (merged.prover) {
        throw new KeyStoreLoadError(
          'Multiple prover configurations found across keystore files. Only one prover configuration is allowed.',
          `keystores[${i}].prover`,
        );
      }
      merged.prover = keystore.prover;
    }
  }

  // Clean up empty arrays
  if (merged.validators!.length === 0) {
    delete merged.validators;
  }

  return merged;
}

/**
 * Extracts attester addresses/keys for coarse duplicate checking during merge.
 *
 * This avoids expensive resolution/decryption and is intended as a best-effort
 * guard only. Full duplicate detection is done in the validator client after
 * accounts are fully resolved.
 *
 * @param attester The attester configuration in any supported shape.
 * @returns Array of string keys used to detect duplicates.
 */
function extractAttesterKeys(attester: unknown): string[] {
  // String forms (private key or other) - return as-is for coarse uniqueness
  if (typeof attester === 'string') {
    return [attester];
  }

  // Arrays of attester items
  if (Array.isArray(attester)) {
    const keys: string[] = [];
    for (const item of attester) {
      keys.push(...extractAttesterKeys(item));
    }
    return keys;
  }

  if (attester && typeof attester === 'object') {
    const obj = attester as Record<string, unknown>;

    // New shape: { eth: EthAccount, bls?: BLSAccount }
    if ('eth' in obj) {
      return extractAttesterKeys(obj.eth);
    }

    // Remote signer account object shape: { address, remoteSignerUrl?, ... }
    if ('address' in obj) {
      return [String((obj as any).address)];
    }

    // Mnemonic or other object shapes: stringify
    return [JSON.stringify(attester)];
  }

  // Fallback stringify for anything else (null/undefined)
  return [JSON.stringify(attester)];
}
