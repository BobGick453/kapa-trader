// Phones and small tablets get the 900px-wide layout, scaled to the screen, like the reference bot:
// every tab and card stays in view at once. Runs before the app so the layout never jumps.
(function () {
    try {
        var w = Math.min(screen.width, screen.height);
        if (w < 900) {
            document.querySelector('meta[name=viewport]').setAttribute('content', 'width=900, viewport-fit=cover');
        }
    } catch (e) {
        /* keep the default viewport */
    }
})();
