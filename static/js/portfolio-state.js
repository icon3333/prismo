/**
 * Global Portfolio State Management
 *
 * Provides a unified API for persisting portfolio selection across all pages.
 * Uses the existing expanded_state database table with page_name = 'global'.
 */
const PortfolioState = {
    /**
     * Get the currently selected portfolio ID from global state.
     * @returns {Promise<string|null>} Portfolio ID or null if none selected
     */
    async getSelectedPortfolio() {
        try {
            const response = await fetch('/portfolio/api/state?page=global');
            if (!response.ok) return null;
            const data = await response.json();
            return data.selectedPortfolioId || null;
        } catch (error) {
            console.warn('Failed to load global portfolio selection:', error);
            return null;
        }
    },

    /**
     * Save the selected portfolio ID to global state.
     * @param {string|number} portfolioId - The portfolio ID to save
     */
    async setSelectedPortfolio(portfolioId) {
        try {
            await fetch('/portfolio/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: 'global',
                    selectedPortfolioId: String(portfolioId)
                })
            });
        } catch (error) {
            console.warn('Failed to save global portfolio selection:', error);
        }
    }
};

// Make available globally
window.PortfolioState = PortfolioState;
