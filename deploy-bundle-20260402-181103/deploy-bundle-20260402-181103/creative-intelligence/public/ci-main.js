(function() {
    'use strict';

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        // Nav items and view containers are now defined in creative.html directly.
        // This function is kept as a no-op for backwards compatibility.
        // Click handlers and view switching are handled by app.js.
    }
})();
