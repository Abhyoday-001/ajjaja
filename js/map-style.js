/* Domino Sky — map look: colour scales, light and dark palettes, terrain imagery and the theme / style switches. */
(function (G) {
  'use strict';
  const DS = G.DS;
  const GEN = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#a3a3a3'];
  const colDelay = d => (d <= 15 ? '#34d399' : d <= 45 ? '#fbbf24' : d <= 120 ? '#fb923c' : '#f87171');
  const colGen = g => (g < 0 ? '#34d399' : GEN[Math.min(g, 4)]);

  // ---------------------------------------------------------------- palettes
  const PALS = {
    dark: {
      name: 'dark',
      ocean0: '#0f1113',
      ocean1: '#111316',
      grid: 'rgba(255,255,255,.035)',
      gridText: 'rgba(255,255,255,.28)',
      land: [
        [75, '#1b1e22'],
        [-60, '#1b1e22']
      ],
      border: 'rgba(255,255,255,.10)',
      coast: 'rgba(255,255,255,.27)',
      shelf: 'rgba(255,255,255,0)',
      label: 'rgba(255,255,255,.24)',
      route: 'rgba(255,255,255,.045)',
      halo: 'rgba(10,13,18,.92)',
      apRing: '#c9d1dc',
      apFill: '#121720',
      apText: '#d9dfe8',
      night: [3, 5, 10],
      nightAlpha: 0.3,
      shadow: 'rgba(0,0,0,.45)',
      plane: '#0a0d12',
      terrain: {
        img: 'assets/earth-terrain-dark.jpg',
        veil: 'rgba(6,9,14,.26)',
        border: 'rgba(255,255,255,.36)',
        label: 'rgba(255,255,255,.88)',
        labelHalo: 'rgba(4,8,14,.80)',
        water: 'rgba(196,220,244,.78)',
        grid: 'rgba(255,255,255,.07)',
        route: 'rgba(255,255,255,.12)'
      }
    },
    light: {
      name: 'light',
      ocean0: '#d6d9d9',
      ocean1: '#d1d5d6',
      grid: 'rgba(0,0,0,.05)',
      gridText: 'rgba(0,0,0,.40)',
      land: [
        [75, '#efece5'],
        [-60, '#efece5']
      ],
      border: 'rgba(0,0,0,.14)',
      coast: 'rgba(0,0,0,.30)',
      shelf: 'rgba(255,255,255,0)',
      label: 'rgba(0,0,0,.34)',
      route: 'rgba(0,0,0,.06)',
      halo: 'rgba(255,255,255,.92)',
      apRing: '#33404f',
      apFill: '#ffffff',
      apText: '#1c2733',
      night: [30, 45, 80],
      nightAlpha: 0.12,
      shadow: 'rgba(20,40,60,.28)',
      plane: '#1a2230',
      terrain: {
        img: 'assets/earth-terrain-light.jpg',
        veil: 'rgba(255,248,235,.05)',
        border: 'rgba(70,48,20,.46)',
        label: 'rgba(38,32,22,.90)',
        labelHalo: 'rgba(255,255,255,.72)',
        water: 'rgba(235,245,255,.92)',
        grid: 'rgba(0,0,0,.09)',
        route: 'rgba(0,0,0,.14)'
      }
    }
  };
  // Relief imagery: NASA Blue Marble (with ocean-floor shading) for the dark theme, a shaded-relief atlas map for the light theme.
  // Loaded on demand; drawing falls back to the flat vector map until an image has arrived.
  const RELIEF = {};
  function getRelief(src, onload) {
    if (!RELIEF[src]) {
      const im = new Image();
      im.decoding = 'async';
      im.onload = onload;
      im.src = src;
      RELIEF[src] = im;
    }
    return RELIEF[src];
  }
  DS.mapStyle = 'terrain';
  DS.setMapStyle = name => {
    DS.mapStyle = name === 'minimal' ? 'minimal' : 'terrain';
  };
  DS.pal = PALS.dark;
  DS.themeName = 'dark';
  DS.setTheme = name => {
    DS.pal = PALS[name] || PALS.dark;
    DS.themeName = DS.pal.name;
  };

  Object.assign(DS, { colDelay, colGen, GENCOL: GEN, getRelief });
})(window);
