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
        // Use floating control button
        this.toggleButton = document.getElementById('floating-blur-toggle');
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

        // Update emoji icon - eye when values visible, see-no-evil monkey when hidden
        const icon = this.toggleButton.querySelector('.icon-blur');
        if (icon) {
            icon.textContent = this.isEnabled ? '🙈' : '👁️';
        }
    }
}

// Initialize on script load and expose globally
window.anonymousModeManager = new AnonymousModeManager();
