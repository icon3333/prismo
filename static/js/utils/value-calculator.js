/**
 * Centralized value calculation utility for frontend.
 * Single source of truth for calculating portfolio item values in JavaScript.
 *
 * This module provides consistent value calculation across all frontend pages,
 * ensuring that custom values are properly used when available.
 *
 * Philosophy: Simple, Modular, Elegant, Efficient, Robust
 *
 * @module PortfolioValueCalculator
 */

/**
 * Calculate the total value of a portfolio item.
 *
 * Uses custom_total_value if available and valid,
 * otherwise calculates from price_eur * effective_shares.
 *
 * This is the single source of truth for value calculation.
 * Use this function everywhere to ensure consistency.
 *
 * @param {Object} item - Portfolio item with properties:
 *   @param {boolean} item.is_custom_value - Whether custom value is set
 *   @param {number|null} item.custom_total_value - Custom total value if set
 *   @param {number|null} item.price_eur - Market price in EUR
 *   @param {number|null} item.effective_shares - Number of shares
 * @returns {number} Total value in EUR
 *
 * @example
 * // Item with custom value
 * const item1 = {is_custom_value: true, custom_total_value: 165938.39};
 * calculateItemValue(item1); // Returns 165938.39
 *
 * @example
 * // Item with market price
 * const item2 = {price_eur: 100, effective_shares: 10};
 * calculateItemValue(item2); // Returns 1000
 *
 * @example
 * // Item with no price or custom value
 * const item3 = {};
 * calculateItemValue(item3); // Returns 0
 */
function calculateItemValue(item) {
    // Use custom value if explicitly set
    if (item.is_custom_value && item.custom_total_value != null) {
        return parseFloat(item.custom_total_value) || 0;
    }

    // Otherwise calculate from price * shares
    const price = parseFloat(item.price_eur) || 0;
    const shares = parseFloat(item.effective_shares) || 0;
    return price * shares;
}

/**
 * Calculate total value across multiple portfolio items.
 *
 * This uses calculateItemValue() for each item to ensure
 * custom values are properly accounted for.
 *
 * @param {Array<Object>} items - Array of portfolio item objects
 * @returns {number} Total portfolio value in EUR
 *
 * @example
 * const items = [
 *     {price_eur: 100, effective_shares: 10},
 *     {is_custom_value: true, custom_total_value: 5000},
 *     {price_eur: 50, effective_shares: 20}
 * ];
 * calculatePortfolioTotal(items); // Returns 7000 (1000 + 5000 + 1000)
 */
function calculatePortfolioTotal(items) {
    if (!Array.isArray(items)) {
        console.warn('calculatePortfolioTotal: items is not an array', items);
        return 0;
    }

    return items.reduce((sum, item) => sum + calculateItemValue(item), 0);
}

/**
 * Check if an item has either a market price or a custom value.
 *
 * This is useful for filtering items that have some form of valuation.
 *
 * @param {Object} item - Portfolio item object
 * @returns {boolean} True if item has price or custom value, false otherwise
 *
 * @example
 * hasPriceOrCustomValue({price_eur: 100}); // Returns true
 * hasPriceOrCustomValue({is_custom_value: true, custom_total_value: 1000}); // Returns true
 * hasPriceOrCustomValue({}); // Returns false
 */
function hasPriceOrCustomValue(item) {
    // Has custom value
    if (item.is_custom_value && item.custom_total_value != null) {
        return true;
    }

    // Has market price
    if (item.price_eur != null && item.price_eur > 0) {
        return true;
    }

    return false;
}

/**
 * Get the source of the value for an item.
 *
 * Returns a string indicating whether the value comes from
 * custom input or market price calculation.
 *
 * @param {Object} item - Portfolio item object
 * @returns {string} 'custom', 'market', or 'none'
 *
 * @example
 * getValueSource({is_custom_value: true, custom_total_value: 1000}); // Returns 'custom'
 * getValueSource({price_eur: 100, effective_shares: 10}); // Returns 'market'
 * getValueSource({}); // Returns 'none'
 */
function getValueSource(item) {
    if (item.is_custom_value && item.custom_total_value != null) {
        return 'custom';
    } else if (item.price_eur != null && item.price_eur > 0) {
        return 'market';
    } else {
        return 'none';
    }
}

// Export for CommonJS/Node.js module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateItemValue,
        calculatePortfolioTotal,
        hasPriceOrCustomValue,
        getValueSource
    };
}

// Make available globally for browser environments
if (typeof window !== 'undefined') {
    window.PortfolioValueCalculator = {
        calculateItemValue,
        calculatePortfolioTotal,
        hasPriceOrCustomValue,
        getValueSource
    };
}

// Also export individual functions for direct import
if (typeof window !== 'undefined') {
    window.calculateItemValue = calculateItemValue;
    window.calculatePortfolioTotal = calculatePortfolioTotal;
    window.hasPriceOrCustomValue = hasPriceOrCustomValue;
    window.getValueSource = getValueSource;
}
