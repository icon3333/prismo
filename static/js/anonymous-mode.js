/**
 * Anonymous Mode Toggle
 * Manages visibility of sensitive financial values for screen sharing privacy
 *
 * NOTE: This is a visual privacy tool, not a security feature.
 * Values remain in the DOM and are accessible via browser DevTools.
 */

class AnonymousModeManager {
    constructor() {
        this.storageKey = 'anonymousModeEnabled';
        this.toggleButton = null;
        this.isEnabled = false;

        this.init();
    }

    init() {
        // Restore state from sessionStorage (early script in head already applied class)
        // This syncs the JS state with what's already on documentElement
        this.isEnabled = sessionStorage.getItem(this.storageKey) === 'true';

        if (this.isEnabled) {
            document.documentElement.classList.add('anonymous-mode');
        }

        // Setup toggle button when DOM ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupToggleButton());
        } else {
            this.setupToggleButton();
        }
    }

    setupToggleButton() {
        this.toggleButton = document.getElementById('anonymous-mode-toggle');
        if (this.toggleButton) {
            this.toggleButton.addEventListener('click', () => this.toggle());
            this.updateToggleButton();
        }
    }

    toggle() {
        this.isEnabled = !this.isEnabled;
        sessionStorage.setItem(this.storageKey, this.isEnabled.toString());

        if (this.isEnabled) {
            document.documentElement.classList.add('anonymous-mode');
        } else {
            document.documentElement.classList.remove('anonymous-mode');
        }

        this.updateToggleButton();
    }

    enable() {
        if (!this.isEnabled) {
            this.toggle();
        }
    }

    disable() {
        if (this.isEnabled) {
            this.toggle();
        }
    }

    updateToggleButton() {
        if (!this.toggleButton) return;

        // Update aria-pressed state for accessibility
        this.toggleButton.setAttribute('aria-pressed', this.isEnabled.toString());

        // Toggle active class for styling
        this.toggleButton.classList.toggle('active', this.isEnabled);

        // Update title/tooltip
        this.toggleButton.title = this.isEnabled
            ? 'Show monetary values'
            : 'Hide monetary values for screen sharing';

        // Update icon
        this.updateIcon();
    }

    updateIcon() {
        if (!this.toggleButton) return;

        // SVG icons - eye-off when values visible, incognito when hidden
        const eyeOffIcon = `
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="1" y1="1" x2="23" y2="23" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;

        // Incognito/spy icon - hat and glasses silhouette
        const incognitoIcon = `
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6 2 6s2 2 4 2.5V10c0 1 .5 2 2 2.5V14c-2 0-3 1-3 2v2c0 1 1 2 2 2h2c1 0 2-1 2-2v-1h2v1c0 1 1 2 2 2h2c1 0 2-1 2-2v-2c0-1-1-2-3-2v-1.5c1.5-.5 2-1.5 2-2.5V8.5c2-.5 4-2.5 4-2.5s-4.48-4-10-4z" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="8" cy="14" r="2" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="16" cy="14" r="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M10 14h4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;

        this.toggleButton.innerHTML = this.isEnabled ? incognitoIcon : eyeOffIcon;
    }
}

// Initialize on script load and expose globally
window.anonymousModeManager = new AnonymousModeManager();
