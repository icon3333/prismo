/**
 * German Locale Utilities
 *
 * Provides functions for parsing and formatting numbers according to German locale conventions:
 * - Thousand separator: dot (.)
 * - Decimal separator: comma (,)
 * - Currency symbol: € (Euro)
 */

/**
 * Parse German locale formatted number to JavaScript number
 *
 * Handles various input formats:
 * - "€1.941.184,76" → 1941184.76
 * - "1.941.184,76" → 1941184.76
 * - "1941184,76" → 1941184.76
 * - "1941184.76" → 1941184.76 (also handles non-German format)
 * - "€ 1.941.184,76" → 1941184.76 (with spaces)
 * - "" → 0
 * - null/undefined → 0
 *
 * @param {string|number} str - The string to parse
 * @returns {number} The parsed number, or 0 if invalid
 */
function parseGermanNumber(str) {
    // Handle null/undefined/empty
    if (str === null || str === undefined || str === '') return 0;

    // If already a number, return it
    if (typeof str === 'number') return str;

    // Convert to string and trim
    let cleaned = String(str).trim();

    // Remove currency symbols and spaces
    cleaned = cleaned.replace(/[€\s]/g, '');

    // Remove dots (thousand separators in German locale)
    cleaned = cleaned.replace(/\./g, '');

    // Convert comma to dot (decimal separator: German → JS)
    cleaned = cleaned.replace(',', '.');

    // Parse the result
    const result = parseFloat(cleaned);
    return isNaN(result) ? 0 : result;
}

/**
 * Format number to German locale (no currency symbol)
 *
 * Examples:
 * - 1941184.76 → "1.941.184,76"
 * - 100 → "100,00"
 * - 0.99 → "0,99"
 *
 * @param {number} value - The number to format
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} The formatted number string
 */
function formatGermanNumber(value, decimals = 2) {
    if (!value && value !== 0) return '0';

    return new Intl.NumberFormat('de-DE', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(value);
}

/**
 * Format number to German locale currency
 *
 * Examples:
 * - 1941184.76 → "€1.941.184,76" (actually formats as "1.941.184,76 €" in de-DE)
 * - 100 → "€100,00"
 * - 0 → "€0,00"
 *
 * @param {number} value - The number to format
 * @returns {string} The formatted currency string
 */
function formatGermanCurrency(value) {
    if (!value && value !== 0) return '0,00 €';

    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR'
    }).format(value);
}
