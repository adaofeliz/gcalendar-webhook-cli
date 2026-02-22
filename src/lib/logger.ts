/**
 * Logger module for gcalendar-webhook-cli
 * Handles debug, warning, error, and standard output
 */

let verbose = false;

/**
 * Set the verbose flag (called by commander --verbose option)
 */
export function setVerbose(flag: boolean): void {
  verbose = flag;
}

/**
 * Get the current verbose flag state
 */
export function getVerbose(): boolean {
  return verbose;
}

/**
 * Debug message - only printed when verbose is true
 */
export function debug(msg: string): void {
  if (verbose) {
    process.stderr.write(`DEBUG: ${msg}\n`);
  }
}

/**
 * Warning message - always printed to stderr with WARNING prefix
 */
export function warn(msg: string): void {
  process.stderr.write(`WARNING: ${msg}\n`);
}

/**
 * Error message - always printed to stderr with ERROR prefix
 */
export function error(msg: string): void {
  process.stderr.write(`ERROR: ${msg}\n`);
}

/**
 * Error message with hint - prints "ERROR: {msg}. {hint}."
 */
export function errorWithHint(msg: string, hint: string): void {
  process.stderr.write(`ERROR: ${msg}. ${hint}.\n`);
}

/**
 * Standard log message - printed to stdout
 */
export function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/**
 * Get stack trace from an Error object
 * Only used when verbose is true
 */
export function getStackTrace(error: Error): string {
  return error.stack || error.toString();
}
