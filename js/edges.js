// Edges (picked after each day, kept for the career) and mandates (optional
// handicaps for more Rep). Pure: no DOM, no timers.
import { EDGES, EDGE_CHOICES, MANDATES, PERKS } from './config.js';
import { mulberry32, hashSeed } from './engine.js';

export const edgeById = (id) => EDGES.find((e) => e.id === id);
export const mandateById = (id) => MANDATES.find((m) => m.id === id);
const perk = (id) => PERKS.find((p) => p.id === id);

/** Edges that can still be offered: not already held, and allowed at this tier. */
export function edgePool(held = [], tierId = 'tier1') {
  return EDGES.filter((e) => !held.includes(e.id) && (!e.tiers || e.tiers.includes(tierId)));
}

/** Seeded weighted draw of `count` different edges from `pool`. */
export function drawEdges(seed, key, pool, count) {
  const rng = mulberry32(hashSeed(seed, 'edges', key));
  const left = [...pool];
  const out = [];
  while (out.length < count && left.length) {
    const total = left.reduce((s, e) => s + e.weight, 0);
    let r = rng() * total;
    let i = 0;
    while (i < left.length - 1 && (r -= left[i].weight) >= 0) i++;
    out.push(left.splice(i, 1)[0].id);
  }
  return out;
}

/** How many edges a draft shows, with the Analyst perk. */
export const choiceCount = (perks = []) => EDGE_CHOICES + (perks.includes('analyst') ? perk('analyst').extraChoices : 0);
/** Rerolls allowed per draft, with the Reroll perk. */
export const rerollsAllowed = (perks = []) => (perks.includes('reroll') ? perk('reroll').rerolls : 0);

/** Mark a draft as due (after a day closes or a promotion). Saved with the run. */
export function openDraft(run) {
  return { ...run, draft: { key: `${run.tier}:${run.day}:${run.history.length}`, rerolls: 0 } };
}

/** The cards on offer for the run's pending draft (empty when none is due or the pool is empty). */
export function draftOffer(run) {
  if (!run.draft) return [];
  const pool = edgePool(run.edges, run.tier);
  return drawEdges(run.seed, `${run.draft.key}:${run.draft.rerolls}`, pool, choiceCount(run.perks));
}

export function rerollDraft(run) {
  if (!run.draft || run.draft.rerolls >= rerollsAllowed(run.perks)) return run;
  return { ...run, draft: { ...run.draft, rerolls: run.draft.rerolls + 1 } };
}

/** Take an edge: it joins the career, and the draft closes. */
export function takeEdge(run, id) {
  const e = edgeById(id);
  if (!e || run.edges.includes(id)) return { ...run, draft: null };
  return { ...run, edges: [...run.edges, id], rewinds: run.rewinds + (id === 'rewind' ? e.uses : 0), draft: null };
}

/** Head Start perk: one random edge at the start of a career. */
export function headStart(run) {
  if (!run.perks.includes('headStart')) return run;
  const [id] = drawEdges(run.seed, 'head', edgePool(run.edges, run.tier), 1);
  return id ? takeEdge(run, id) : run;
}

/** What the career's edges and mandates do to the rules today. */
export function careerOf(run) {
  const last = run.history?.[run.history.length - 1];
  return { edges: run.edges || [], mandates: run.mandates || [], hot: (run.edges || []).includes('hotHand') && !!last && last.pnl > 0 };
}

/** Rep multiplier for the career: mandate bonuses add, Rainmaker multiplies. */
export function repMultiplier(run) {
  const m = (run.mandates || []).reduce((s, id) => s + (mandateById(id)?.repBonus || 0), 0);
  const rain = (run.edges || []).includes('rainmaker') ? 1 + edgeById('rainmaker').repBonus : 1;
  return Math.round((1 + m) * rain * 100) / 100;
}
