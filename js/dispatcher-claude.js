/* Domino Sky — AI dispatcher, part 3: the optional Claude client.

   Lets a real LLM do the talking. It gets read-only tools backed by the engine and is told to copy numbers from them; its
   answer goes through the same auditor, so a number it invents is highlighted. Nothing here runs unless the user supplies a
   key and consents. Loaded after dispatcher-audit.js; registers its functions on DS.Dispatcher. */
(function (G) {
  'use strict';
  const DS = G.DS;
  const {
    problems,
    snapshot,
    crewRows,
    evaluateCandidates,
    explainFlight,
    identifiers,
    collectNumbers,
    verifyText
  } = DS.Dispatcher;

  // ---------------------------------------------------------------- Claude (optional): tools are read-only views of the engine
  const TOOLS = [
    {
      name: 'get_situation',
      description:
        'Current state of the network at the simulation clock: problems, flights late/cancelled/diverted so far, passengers stranded, root causes, crew status, and full-day totals for the current plan and for doing nothing. Every number you state must come from this or the other tools.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'get_recommendations',
      description:
        'The simulator tests every recovery measure against the whole day and returns the best ones, each with exact before and after metrics. Use these ids (A1, A2, …) when you recommend something; you cannot invent other actions.',
      input_schema: {
        type: 'object',
        properties: {
          objective: {
            type: 'string',
            enum: ['pax', 'flights', 'stranded'],
            description: 'What to optimise: passenger delay, aircraft delay or people stranded.'
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'explain_flight',
      description:
        'Why a specific flight is late or cancelled: delay components, the chain of earlier flights on the same aircraft, buffers, connecting passengers affected.',
      input_schema: {
        type: 'object',
        properties: { flight_number: { type: 'string', description: 'e.g. SK123' } },
        required: ['flight_number'],
        additionalProperties: false
      }
    },
    {
      name: 'get_crews',
      description:
        'Crew duty clocks: legal limit, projected finish and margin for the crews closest to their limit.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false }
    }
  ];
  const r1 = x => Math.round(x * 10) / 10;
  function toolImpl(ctx, name, input, state) {
    switch (name) {
      case 'get_situation': {
        const m = DS.metricsAt(ctx.res, ctx.now),
          dg = DS.diagnose(ctx.net, ctx.res, ctx.now),
          tot = dg.direct + dg.knock || 1;
        return {
          clock: { time: ctx.now, timeZone: ctx.net.meta.tzLabel },
          network: {
            name: ctx.net.meta.name,
            airports: ctx.net.airports.length,
            flights: ctx.net.flights.length,
            aircraft: ctx.net.tails.filter(t => !t.spare).length,
            spareAircraftAvailable: ctx.net.tails.filter(
              t => t.spare && !ctx.plan.some(a => a.type === 'swap' && a.spare === t.id)
            ).length
          },
          problems: problems(ctx.net, ctx.weather, ctx.now),
          soFar: {
            flightsDue: m.due,
            late: m.delayed,
            cancelled: m.cancelled,
            diverted: m.diverted,
            onTimePercent: r1(m.otp * 100),
            passengerDelayHours: Math.round(m.paxDelayMin / 60),
            stranded: m.stranded,
            missedConnectionPassengers: m.missedPax
          },
          rootCauses: dg.roots.slice(0, 4).map(r => ({
            cause: r.root,
            sharePercent: Math.round((r.total / tot) * 100),
            passengerHours: Math.round(r.total / 60),
            flights: r.flights + r.cancels
          })),
          knockOnPercent: Math.round((dg.knock / tot) * 100),
          planMeasures: ctx.plan.length,
          fullDayWithCurrentPlan: roundSnap(snapshot(ctx.net, ctx.res)),
          fullDayDoingNothing: roundSnap(snapshot(ctx.net, ctx.base)),
          crewsAtRisk: crewRows(ctx.net, ctx.res, ctx.plan).filter(
            c => c.status === 'at risk' || c.status === 'timed out'
          ).length
        };
      }
      case 'get_recommendations': {
        const ev = evaluateCandidates(
          Object.assign({}, ctx, { objective: (input && input.objective) || ctx.objective || 'pax' }),
          5
        );
        state.candidates = ev.items;
        return {
          measuresTested: ev.tested,
          objective: ev.objective,
          before: roundSnap(ev.before),
          recommendations: ev.items.map(it => ({
            id: it.id,
            title: it.title,
            after: roundSnap(it.after),
            improvement: {
              passengerHours: Math.round(it.before.paxHours - it.after.paxHours),
              aircraftHours: Math.round(it.before.aircraftHours - it.after.aircraftHours),
              strandedPeople: it.before.stranded - it.after.stranded,
              cancelledFlights: it.before.cancelled - it.after.cancelled,
              lateFlights: it.before.lateFlights - it.after.lateFlights
            }
          }))
        };
      }
      case 'explain_flight': {
        const key = String((input && input.flight_number) || '')
            .replace(/\s/g, '')
            .toUpperCase(),
          f = ctx.res.flights.find(x => x.num.toUpperCase() === key);
        if (!f)
          return {
            error:
              'No flight with that number. Examples: ' +
              ctx.res.flights
                .slice(0, 5)
                .map(x => x.num)
                .join(', ')
          };
        return explainFlight(ctx.net, ctx.res, f.id, ctx.weather);
      }
      case 'get_crews': {
        const rows = crewRows(ctx.net, ctx.res, ctx.plan);
        return {
          crews: rows.length,
          flagged: rows.filter(r => r.status !== 'ok').length,
          tightest: rows.slice(0, 5)
        };
      }
    }
    return { error: 'unknown tool' };
  }
  const roundSnap = s => ({
    passengerDelayHours: Math.round(s.paxHours),
    aircraftDelayHours: Math.round(s.aircraftHours),
    lateFlights: s.lateFlights,
    cancelledFlights: s.cancelled,
    divertedFlights: s.diverted,
    strandedPeople: s.stranded,
    missedConnectionPassengers: s.missedConnectionPax,
    onTimePercent: r1(s.onTimePct),
    crewTimeouts: s.crewTimeouts,
    totalFlights: s.totalFlights
  });

  const SYSTEM =
    'You are the AI dispatcher inside Domino Sky, an airline disruption simulator. A deterministic simulation engine is the only source of numbers. You cannot calculate delays, passengers or crew limits yourself. ' +
    'Call the tools to get facts, then explain and recommend in plain English for a duty controller: 120 words or fewer, no markdown tables. ' +
    'Rules: (1) every number and clock time you write must be copied exactly from a tool result — never round differently, convert units, sum, subtract or estimate; if you need a figure the tools did not return, say you do not have it; ' +
    '(2) recommend only actions returned by get_recommendations, naming them by id and title; (3) never mention dates or years; (4) state units (minutes, hours, passengers). Your numbers are audited automatically against the engine and any mismatch is shown to the user.';
  const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2'];

  // A tiny first-party client for POST /v1/messages. Deliberately NOT a CDN-loaded SDK: no third-party code ever sees the API key,
  // and the only host the key is sent to is api.anthropic.com. Same request shape as the official SDKs (betas go in the anthropic-beta header).
  const API_URL = 'https://api.anthropic.com/v1/messages';
  function fetchClient(apiKey) {
    const call = async req => {
      const body = Object.assign({}, req);
      const betas = body.betas;
      delete body.betas;
      const headers = {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };
      if (betas && betas.length) headers['anthropic-beta'] = betas.join(',');
      const r = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        referrerPolicy: 'no-referrer',
        credentials: 'omit'
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || 'Anthropic API returned HTTP ' + r.status);
      return j;
    };
    return { messages: { create: call }, beta: { messages: { create: call } } };
  }

  async function askClaude(ctx, question, opts) {
    opts = opts || {};
    const state = { candidates: null },
      truthParts = [],
      model = opts.model || 'claude-opus-5-5';
    let client = opts.client;
    if (!client) {
      if (!opts.apiKey) throw new Error('Enter an Anthropic API key to use Claude.');
      client = fetchClient(opts.apiKey);
    }
    const useFallback = FALLBACK_MODELS.includes(model);
    const messages = [{ role: 'user', content: question }],
      used = [];
    for (let turn = 0; turn < 6; turn++) {
      const req = { model, max_tokens: 16000, system: SYSTEM, tools: TOOLS, messages };
      let resp;
      if (useFallback)
        resp = await client.beta.messages.create(
          Object.assign(req, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        );
      else resp = await client.messages.create(req);
      if (resp.stop_reason === 'refusal')
        throw new Error(
          'Claude declined this request' +
            (resp.stop_details && resp.stop_details.category ? ' (' + resp.stop_details.category + ')' : '') +
            '.'
        );
      messages.push({ role: 'assistant', content: resp.content }); // thinking blocks and tool_use go back unchanged
      const uses = resp.content.filter(b => b.type === 'tool_use');
      if (resp.stop_reason === 'max_tokens' && uses.length)
        throw new Error('Claude ran out of output tokens mid tool call; try again.');
      if (!uses.length) {
        const text = resp.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim();
        const idsAll = identifiers(ctx.net).concat(['A1', 'A2', 'A3', 'A4', 'A5']),
          truth = collectNumbers(truthParts, null, null, idsAll),
          v = verifyText(text, truth, idsAll);
        return {
          title: 'Claude’s answer',
          text,
          html: null,
          verification: v,
          source: 'claude',
          model,
          toolsUsed: used,
          candidates: state.candidates
        };
      }
      const results = uses.map(u => {
        let out;
        try {
          out = toolImpl(ctx, u.name, u.input || {}, state);
        } catch (e) {
          out = { error: String(e.message || e) };
        }
        truthParts.push(out);
        used.push(u.name);
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) };
      });
      messages.push({ role: 'user', content: results });
    }
    throw new Error('Claude did not finish within the tool-call limit.');
  }

  Object.assign(DS.Dispatcher, { askClaude, fetchClient, API_URL, TOOLS, toolImpl, SYSTEM });
  if (typeof module !== 'undefined') module.exports = DS;
})(typeof window !== 'undefined' ? window : globalThis);
