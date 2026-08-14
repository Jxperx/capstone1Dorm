/**
 * Environment-aware Logger Utility
 * - development: Logs everything (info, debug, warn, error)
 * - production:  Only logs warnings and errors (suppresses info/debug)
 */
const isProduction = process.env.NODE_ENV === 'production';

const logger = {
    /** General info messages — hidden in production */
    info: (...args) => { if (!isProduction) console.log(...args); },

    /** Verbose debug messages — hidden in production */
    debug: (...args) => { if (!isProduction) console.log(...args); },

    /** Warnings — always visible */
    warn: (...args) => { console.warn(...args); },

    /** Errors — always visible */
    error: (...args) => { console.error(...args); }
};

module.exports = logger;
