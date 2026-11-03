// Slurp Pot Feast mode (GDD §6, §13.3). Sim role. Wednesday deliverable: today these are stubs that throw.
// Pure and deterministic like logic.js; imports only consts.js and logic.js.
import { FEAST } from './consts.js';

const notYet = name => { throw new Error('feast.' + name + ': not yet (Wednesday)'); };

/** Feast state for a town and seed: {seed, town, ...}. */
export function createFeast(town, seed) { notYet('createFeast'); return { town, seed, FEAST }; }
/** The expanded endless-board level for logic.createWorld. */
export function feastLevel(fs) { return notYet('feastLevel'); }
/** The k-th rolling ticket. */
export function feastTicket(fs, k) { return notYet('feastTicket'); }
/** Per-step Feast rules after logic.step (ticket roll-over, respawns, clock adds). */
export function feastStep(fs, w, dt) { return notYet('feastStep'); }
/** {tickets, coins, pb, ...} after the Feast ends. */
export function feastResult(fs) { return notYet('feastResult'); }
