/* Domino Sky — Accessibility enhancer: makes everything the app draws keyboard-operable and named.
   Clickable rows and cards get focus and a button role, sliders and selects get labels, table headers get scope, and the two
   tab bars follow the WAI-ARIA tabs pattern with arrow keys. */
(function () {
  'use strict';
  function boot() {
    const U = window.DominoSky;
    const api = U.api;
    const { $ } = api;

    // Everything the app draws with innerHTML is passed through here: clickable rows/cards become keyboard-operable,
    // sliders and selects get names, table headers get scope, and the two tab bars follow the WAI-ARIA tabs pattern.
    const CLICKABLE =
      'tr.click, .dom[data-act], td[data-act], [data-act]:not(button):not(a):not(input):not(select):not(tr)';
    // Scoped to the nodes that were just added, so the 4-per-second live refresh does not re-scan the whole document.
    const within = (roots, sel) => {
      const out = [];
      roots.forEach(r => {
        if (r.matches && r.matches(sel)) out.push(r);
        if (r.querySelectorAll) r.querySelectorAll(sel).forEach(x => out.push(x));
      });
      return out;
    };
    function enhance(roots) {
      roots = roots && roots.length ? roots : [document.body];
      within(roots, CLICKABLE).forEach(el => {
        if (!el.hasAttribute('tabindex')) {
          el.tabIndex = 0;
          if (el.tagName !== 'TR') el.setAttribute('role', 'button');
        }
      });
      const rows = within(roots, '.sl');
      roots.forEach(r => {
        const p = r.closest && r.closest('.sl');
        if (p) rows.push(p);
      });
      rows.forEach(row => {
        const label = row.querySelector('span');
        row.querySelectorAll('input,select').forEach(c => {
          if (!c.hasAttribute('aria-label') && label) c.setAttribute('aria-label', label.textContent.trim());
        });
      });
      within(roots, 'th:not([scope])').forEach(th => th.setAttribute('scope', 'col'));
      [
        ['#leftTabs', '#leftBody'],
        ['#botTabs', '#botBody']
      ].forEach(([tabs, panel]) => {
        const tl = $(tabs),
          p = $(panel);
        if (!tl || !p) return;
        tl.querySelectorAll('[role=tab]').forEach(t => {
          t.id = t.id || tabs.slice(1) + '-' + t.dataset.tab;
          t.setAttribute('aria-controls', panel.slice(1));
          t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
        });
        const sel = tl.querySelector('[aria-selected=true]');
        if (sel) p.setAttribute('aria-labelledby', sel.id);
      });
    }
    // Runs inside the observer callback itself (a batched microtask): no rAF or timer, both of which browsers throttle in background/headless tabs.
    new MutationObserver(recs => {
      const roots = [];
      recs.forEach(r =>
        r.addedNodes.forEach(n => {
          if (n.nodeType === 1) roots.push(n);
        })
      );
      enhance(roots.length ? roots : [document.body]);
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected']
    });
    document.addEventListener('keydown', e => {
      const t = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && t.matches && t.matches(CLICKABLE)) {
        e.preventDefault();
        t.click();
        return;
      }
      if (
        t.getAttribute &&
        t.getAttribute('role') === 'tab' &&
        ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)
      ) {
        const tabs = [...t.parentElement.querySelectorAll('[role=tab]')];
        let i = tabs.indexOf(t);
        i =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        e.preventDefault();
        tabs[i].focus();
        tabs[i].click();
        setTimeout(() => {
          const nt = $('#' + tabs[i].id);
          if (nt) nt.focus();
        }, 0);
      }
    });
    enhance();
  }
  if (window.DominoSky && window.DominoSky.api) boot();
  else document.addEventListener('domino-sky-ready', boot, { once: true });
})();
