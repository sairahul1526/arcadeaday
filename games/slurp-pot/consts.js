// Slurp Pot constants: extracted verbatim from docs/gdd/2026-11-02-slurp-pot.md §13.2 (frozen Tue 12:00; changes go through Core).
export const DT = 1 / 60, MAX_STEPS = 8, DTREAL_MAX = 0.134;   // fixed sim step; max catch-up steps per frame; real-dt clamp
export const SLOWMO = 0.3, SLOWMO_REAL = 1.2;           // boss bite (slowT lives in game.js, never in w)
export const CAKE_SLOWMO_REAL = 0.6;                    // non-final cake tier bite (Sim 12:32), same SLOWMO scale
export const R0 = 0.30, R0_L1 = 0.25, R0_REC = 0.14, R_MAX = 4.2;   // R0 = default start radius (L2–L10, boss levels, twist intros, Daily, Feast)
export const R0_VAR = [0.30, 0.45, 0.60];               // from L11, non-boss non-twist-intro levels: r0 = R0_VAR[n % 3]
export const SIZEUP_MUL = 1.25;                         // w.pot.sizeUpR[k] = r0 × 1.25^k, built in createWorld by repeated multiplication (§3.3)
export const G = 0.24, K_ING = 0.25, K_WALL = 0.6, BLOCK_K = 0.5;
export const SWALLOW_IN = 0.25, TIP_T = 0.5;            // d < rEff − 0.25a ; tip duration (sim s)
export const CHAIN_WIN = 0.7, CHAIN_GULP = 0.3, SIZZLE_AT = 10, SIZZLE_EVERY = 5, SIZZLE_CAP = 0.10;
export const STAR3 = 0.35, STAR2 = 0.15;
export const TAU_ACC = 0.060, TAU_BRAKE = 0.045, V_BASE = 2.5, V_PER_R = 1.2, V_CAP = 6.0;
// Precomputed at module load so logic.step uses only + − × ÷ sqrt floor min max abs (no exp/log/pow in step):
export const A_ACC = 1 - Math.exp(-DT / TAU_ACC), A_BRAKE = 1 - Math.exp(-DT / TAU_BRAKE);
export const BUMP_V = 1.2, BUMP_CD = 0.35, DOOM_EVERY = 0.25, DOOM_GRACE = 0.6, LOW_TIME = 10;
// DECISION (11-07 Sat r7d, kid13 r7 "SO CLOSE with every ticket done"): when the LAST ticket's padlock pops, the clock is
// floored at the time to reach the boss: straight-line distance / pot speed * k + pad seconds. A player who has done every
// line never loses on the walk. It only lifts a clock that is already low, so stars barely move (a late finish stays 1 star).
export const BOSS_WALK = { k: 1.3, pad: 4 };
// DECISION (11-09, FIX-LIST-7 B1, grandparent r8): lost on L12 with every order ticked, because the pot was still too small for the
// boss (the padlock, and so BOSS_WALK, never fired). Once the final ticket's lines are all done the clock holds at DONE_HOLD s:
// the boss can still take as long as it takes, nobody loses with every order done, and stars read the held clock (1 star).
export const DONE_HOLD = 5;
export const CRACK_V = 2.0, WOBBLE_V = 0.9, WOBBLE_D = 0.8;   // fragile: crack above 2.0 u/s; wobble+bounce 0.9–2.0; near warning within a + r + 0.8
export const SIMMER = { shoveA: 0.5, shoveMax: 0.8, boilT: 0.3, boilV: 0.6 };   // shove junk with a < 0.5r up to 0.8 u; boil 0.3 s at vMax × 0.6
export const GULL = { warn: 1.6, missCoins: 1 };        // telegraph s; target radius = SEE_R(w.pot.r) (logic.js); gullEvery is level data
export const MAGNET = { t: 3, range: 2.5, v: 3 }, FREEZE_ADD = 10, MEGA = { t: 5, mul: 1.25 };
// DECISION (11-07 Sat, r4, Gild): a coin sink for players who own every pot they like. Each owned pot can be gilded once for GILD_PRICE.
export const GILD_PRICE = 600;
export const PRICES = { magnet: 40, freeze: 60, mega: 80, lid: 120 }, LID_MAX = 2;   // lid = Streak Lid (shop shelf, not an in-level booster)
export const BOOST_UNLOCK = { magnet: 6, freeze: 9, mega: 13 }, BOOST_GIFT = { magnet: 2, freeze: 2, mega: 1 };
export const DAILY_UNLOCK = 6, FEAST_UNLOCK = 12, DAILY_START = '2026-11-08';
export const FEAST = { start: 45, add0: 12, addMin: 6, tickets: 4, needMax: 6, sizzleCap: 3, coins: 5, pbCoins: 50 };   // 11-07 (mobile r5): 2 + 25 gave no reason to play it for coins
                                                        // add(c) = c <= 4 ? 12 : max(6, 12 − (c − 4)) (add0 14 → 12 on 11-04: runs were 1.5× the target); need from c5 [2+(c−4), 3+(c−4)] ≤ 6
export const LADDER = [{coins:40},{chest:{coins:60, boost:'freeze'}},{lid:1},{coins:80},{boost:['magnet','mega']},{coins:120},{skin:'starladle', else:{coins:200, boost:'all'}}];
export const SKINS = [['sunny',0],['cauldron',150],['wok',250],['teapot',350],['ricecooker',500],['dutch',650],['steamer',800],['royal',1000],['ufo',1300],['starladle',-1]];
export const TOWNS = ['picnic', 'market', 'harbour'];
export const LEVELS = 60, ITEM_MAX = 340, DECOR_MAX = 40, KINDS_MAX = 18;
export const isMilestone = n => n > 0 && n % 10 === 0;  // L10 ... L60: every level ends on a boss bite, these are the big ones
export const HOT_SECS = 3;                              // a swallowed hot chili burns this much off the clock (floors at 0.1 s)
export const TIER = { low: { dprMax: 1.25, mp: 1.0 }, mid: { dprMax: 2.0, mp: 2.2 }, high: { dprMax: 2.0, mp: 3.5 } };
export const DPR_MIN = 0.75, DPR_START = 1.5, DPR_STEP = 0.125;   // start at min(dprMax, 1.5); adaptive ±0.125 per 2 s window
export const FX_MAX = 256;                              // particle pool (one instanced pool, all tiers)
