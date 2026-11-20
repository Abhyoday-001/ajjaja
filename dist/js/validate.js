/* Domino Sky — import safety.
   Identifiers and names from an imported schedule end up in the page's HTML (tables, tooltips, the map). They are rendered
   through escaping everywhere, but we also refuse anything outside a conservative character set, so a hostile or corrupt
   file is rejected up front with a clear message instead of being trusted. Size caps keep one file from freezing the tab. */
(function (G) {
  'use strict';
  const DS = G.DS;
  const LIMITS = { fileBytes: 5 * 1024 * 1024, flights: 6000, airports: 300, aircraft: 2500 };
  const ID = /^[A-Za-z0-9][A-Za-z0-9 ._\-/~]{0,23}$/; // flight numbers, tail / crew ids, airline codes
  const CODE = /^[A-Za-z0-9]{2,5}$/; // airport codes
  const NAME = /^[\p{L}\p{M}\p{N}\p{Pd} .,'’()&/]{1,80}$/u; // city / airport / airline names: any script, any dash, no markup characters

  function validateNetwork(net) {
    const bad = (what, v) => {
      throw new Error(
        'Import rejected: ' +
          what +
          ' “' +
          String(v)
            .slice(0, 30)
            .replace(/[<>&"]/g, '·') +
          '” contains characters that are not allowed (letters, digits, space and . _ - / ~ only).'
      );
    };
    if (net.flights.length > LIMITS.flights)
      throw new Error(
        'Import rejected: ' +
          net.flights.length +
          ' flights is more than the ' +
          LIMITS.flights +
          ' this browser simulator accepts.'
      );
    if (net.airports.length > LIMITS.airports)
      throw new Error('Import rejected: more than ' + LIMITS.airports + ' airports.');
    if (net.tails.length > LIMITS.aircraft)
      throw new Error('Import rejected: more than ' + LIMITS.aircraft + ' aircraft.');
    net.airports.forEach(a => {
      if (!CODE.test(a.code)) bad('airport code', a.code);
      if (!NAME.test(String(a.city || a.code))) bad('city name', a.city);
      if (!NAME.test(String(a.name || a.code))) bad('airport name', a.name);
      if (!(Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180))
        throw new Error('Import rejected: airport ' + a.code + ' has coordinates outside the globe.');
    });
    net.flights.forEach(f => {
      if (!ID.test(String(f.num))) bad('flight number', f.num);
      if (!ID.test(String(f.tail))) bad('tail / registration', f.tail);
      if (!CODE.test(f.orig)) bad('origin code', f.orig);
      if (!CODE.test(f.dest)) bad('destination code', f.dest);
      if (!(isFinite(f.std) && isFinite(f.sta) && f.sta > f.std))
        throw new Error('Import rejected: flight ' + f.num + ' has unreadable times.');
    });
    net.tails.forEach(t => {
      if (!ID.test(String(t.id))) bad('aircraft id', t.id);
      if (t.crew && !ID.test(String(t.crew))) bad('crew id', t.crew);
    });
    (net.airlines || []).forEach(a => {
      if (!ID.test(String(a.code))) bad('airline code', a.code);
      if (!NAME.test(String(a.name || a.code))) bad('airline name', a.name);
    });
    return net;
  }
  DS.validateNetwork = validateNetwork;
  DS.IMPORT_LIMITS = LIMITS;
  if (typeof module !== 'undefined') module.exports = DS;
})(typeof window !== 'undefined' ? window : globalThis);
