(() => {
    const root = document.querySelector('.hero-carousel');
    const tablist = root.querySelector('[role="tablist"]');
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const panels = [...root.querySelectorAll('[role="tabpanel"]')];
    const localizedImages = [...root.querySelectorAll('[data-src-en][data-src-zh]')];
    let active = 0;
    function syncLocalizedImages() {
        const language = document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
        localizedImages.forEach(image => {
            const source = image.dataset[language === 'zh' ? 'srcZh' : 'srcEn'];
            if (source && image.getAttribute('src') !== source) image.setAttribute('src', source);
        });
    }
    syncLocalizedImages();
    new MutationObserver(syncLocalizedImages).observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
    function show(index, focus = false) {
        active = (index + tabs.length) % tabs.length;
        tabs.forEach((tab, i) => {
            tab.setAttribute('aria-selected', String(i === active));
            tab.tabIndex = i === active ? 0 : -1;
            panels[i].hidden = i !== active;
        });
        if (focus) tabs[active].focus();
        if (tablist.scrollWidth > tablist.clientWidth) {
            const tab = tabs[active];
            const left = tab.offsetLeft - (tablist.clientWidth - tab.offsetWidth) / 2;
            tablist.scrollTo({
                left,
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
            });
        }
    }
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => show(index));
        tab.addEventListener('keydown', event => {
            const next = {ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: tabs.length - 1}[event.key];
            if (next !== undefined) { event.preventDefault(); show(next, true); }
        });
    });
    root.querySelectorAll('[data-hero-step]').forEach(button => button.addEventListener('click', () => show(active + Number(button.dataset.heroStep))));
    let start;
    root.addEventListener('touchstart', event => {
        start = event.touches.length === 1 ? {x: event.touches[0].clientX, y: event.touches[0].clientY} : null;
    }, {passive: true});
    root.addEventListener('touchend', event => {
        if (!start) return;
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(active + (dx < 0 ? 1 : -1));
        start = null;
    }, {passive: true});
    root.addEventListener('touchcancel', () => { start = null; }, {passive: true});
})();
