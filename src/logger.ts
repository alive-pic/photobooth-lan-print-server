// Simple console logger that prefixes errors with a red "[ ERROR ]" tag so they stand out.
// Other console methods (log, warn) are left unchanged for now.

// ANSI escape codes for colours
const RED = "\x1b[31m";   // bright red foreground
// 24-bit RGB for #02C5FF  (2,197,255)
const CYAN_BRIGHT = "\x1b[38;2;2;197;255m";
const RESET = "\x1b[0m";

// Keep the original console fns so we can call inside wrappers
const originalError = console.error.bind(console);
const originalLog = console.log.bind(console);

// Monkey-patch: every console.error will now be prefixed and coloured
export function initErrorLogger(): void {
  console.error = (...args: unknown[]): void => {
    originalError(`${RED}[ ERROR ]${RESET}`, ...args);
  };

  console.log = (...args: unknown[]): void => {
    originalLog(`${CYAN_BRIGHT}[ INFO ]${RESET}`, ...args);
  };
}

// Initialise immediately when the module is imported
initErrorLogger(); 