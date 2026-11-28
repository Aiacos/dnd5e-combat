/**
 * Climbing (SPEC §192, batch 1: walls; batch 2: ceilings). Near a wall, a creature on the ground climbs: its token switches to mode
 * `climb`, rises in place (same cell, elevation + N cells — a move measured in 3D by the core, paid from the turn budget:
 * dnd5e adds 1 ft per ft without a climbing speed, nothing with one), then walks along the wall at that height (the `climb` mode
 * leaves elevation free, runtime/altitude.mjs). Back on the ground, it resumes its previous mode.
 *  - `2024` rules (default): no roll ("Climbing" glossary of the Player's Handbook); `house`: DC 15 Strength (Athletics) to
 *    start, then each turn in combat (at the start of its own) or every 10 s out of combat — a failure makes it fall.
 *  - Fall: dnd5e's (`TokenDocument5e#updateFalling` then `#plummet`, documents/token.mjs:398-444 — 1d6 per 10 ft, Prone
 *    on damage). dnd5e only re-evaluates the fall after a move: a climber made Prone, Incapacitated, Grappled or without speed
 *    is made to fall by the active GM; "Let go" (menu) is a voluntary fall, on the player's client.
 *  - "Climbing" status on the token, held by the active GM from the mode.
 *  - **Ceilings (batch 2)**: "Climb the ceiling" (from the wall, or from the ground near a wall) under a `move` Surface: the token
 *    rises in `climb` up to the ceiling minus its height, flag `climb.ceiling`, status "On the ceiling"; it then walks under
 *    the whole ceiling (the A* leaves it only the cells where the ceiling is at the same height, adapter/path-world.mjs),
 *    a wall is no longer needed; leaving from under the ceiling is refused (2024 rules) or makes it fall (house). Reserved
 *    for creatures that have the capability (`canWalkCeilings`: Spider Climb, Slippers, Cloak of Arachnida, `climbsCeilings`
 *    content); in house mode, any creature tries it at DC 20, redone each turn like the wall's DC 15. The active GM turns the
 *    token upside down (`texture.scaleY`
 *    inverted, the original scale kept in a flag and restored on leaving the ceiling, fall included) if the "Orient tokens in
 *    the direction of movement" setting is inactive. "Climb down the wall" (near a wall) brings it back to the wall then the
 *    ground.
 *  - **Content (batch 3, §195)**: "Run up the wall" (the monk's Acrobatic Movement) — the same climb, without a check, on its
 *    turn (or out of combat); it falls if it ends its turn still on the wall. Slippers of Spider Climbing do not grant the
 *    ceiling on a slippery surface
 *    (Grease, Oil): no menu entry, and a ceiling walker who holds there only through them falls (2024 rules). dnd5e's fall
 *    (`fallLikeDnd5e`) is also used for Reverse Gravity (runtime/elevation-spells.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";
import { CLIMB_DC, CEILING_DC, CLIMB_CHECK_SECONDS, climbableCells, climbCheckDue, flippedScale, acrobaticFallDue, ledgeCost, climbGauge, fallDice } from "../core/climb.mjs";
import { placementOf } from "../core/altitude.mjs";
import {
  CLIMB_RULES_SETTING, CLIMB_FLAG, FLIP_FLAG, climbRules, isClimbing, isOnCeiling, wallsNear, climbingOf, climbFallReasonFor, aboveGround,
  canWalkCeilingsAt, canWalkCeilings, ceilingPerchFor, hangsAt, acrobaticFor, ledgesOf, wallTopOf, levelMarksAbove, edgesBelowOf, wallTopFeetOf
} from "../adapter/climb.mjs";
import { perceivedAt } from "../adapter/illumination.mjs";
import { boundsUnder, groundUnder, groundModeOf, modeRefusalFor } from "../adapter/altitude.mjs";
import { MODE_STATUSES, setStatus } from "../adapter/conditions.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { closeRollDialogAfter } from "../adapter/dialogs.mjs";
import { queryPlayer, waitLabel } from "../adapter/player-wait.mjs";
import { actorOfEffect } from "../adapter/grapple.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { pilotOf, isIntangible } from "../adapter/pilot.mjs";
import { walkOptions, continuedFlags } from "../adapter/movement.mjs";
import { historyCosts, positionOf, tokenCenter, combatantFor, readBudget, writeBudget } from "../adapter/turn.mjs";
import { settingOr } from "../adapter/settings.mjs";
import { ALTITUDE_SETTING } from "./altitude.mjs";
import { movementCap, isGrappled, approach, gapCells } from "./actions.mjs";
import { footprintOf, sizeOf, cellOf } from "../adapter/movement.mjs";
import { rayBlocker } from "../adapter/cover.mjs";
import { cellsAtGap } from "../core/orders.mjs";
import { route } from "./router.mjs";
import { theaterActive } from "./theater-state.mjs";
import { climbSystemOn, whileClimbSystem } from "../core/climb-system.mjs";
import { setClimbSystem } from "./climb-system.mjs";
import { enqueue } from "./queue.mjs";
import { esc, isExecutor, loc, locEsc, log, notice, say, waitForDice } from "./shared.mjs";
import { askAnyway } from "./turn.mjs";
import { forceMoveLater } from "./move-gate.mjs";
import { askFallReactions } from "./reactions.mjs";
import { isEthereal } from "../adapter/plane.mjs";

export const CLIMB_QUERY = `${MODULE_ID}.climbCheck`;
/** The player has this long for their check (their window closes before, at the combat windows' timeout). */
const CHECK_TIMEOUT_MS = 40000;
/** Out of combat, the active GM re-reads the climbers at this rate. */
const TICK_MS = 2500;

const ALTITUDE_OPTIONS = { [MODULE_ID]: { altitude: true } };

/**
 * A creature that climbing concerns: the climbing and falling system on (§224), the "Movement modes and elevation" setting
 * active, not an object nor a driven object.
 */
function concerned(token) {
  if ( !climbSystemOn() || !settingOr(ALTITUDE_SETTING, true) || !token?.actor || (token.actor.system?.isCreature === false) ) return false;
  if ( isEthereal(token) ) return false;   // §225: in the Ethereal, one moves freely in height — nothing to climb
  return !pilotOf(token) && !isIntangible(token) && !isObjectToken(token);
}

function tokensOf(actor) {
  if ( !actor ) return [];
  if ( actor.isToken ) return actor.token ? [actor.token] : [];
  return actor.getDependentTokens?.({ concreteOnly: true }) ?? [];
}

const climbFlag = token => token.getFlag(MODULE_ID, CLIMB_FLAG) ?? null;

/* -------------------------------------------- */
/*  Grimper                                     */
/* -------------------------------------------- */

/** Can this token climb (or climb more): its own, on ground or wall (not ceiling), near a wall, not Grappled, not speedless. */
export function canClimb(token) {
  if ( !token?.isOwner || !concerned(token) || isOnCeiling(token) ) return false;
  if ( !isClimbing(token) && (placementOf(token.movementAction) !== "ground") ) return false;   // flying or underground: no climbing
  if ( isGrappled(token) || climbFallReasonFor(token) ) return false;
  return wallsNear(token).length > 0;
}

/**
 * §217: waits until the token's elevation has left `from` (at most `ms`) — a move that changes level on the way is not
 * yet written when `token.move` returns.
 */
async function elevationSettled(token, from, ms=3000) {
  const until = Date.now() + ms;
  while ( (Math.abs((token._source.elevation ?? 0) - from) < 1e-6) && (Date.now() < until) ) await new Promise(resolve => setTimeout(resolve, 100));
}

/** What this climber can climb now: cells at most (turn budget, ceiling), cost per cell. */
export function climbRoom(token, { forced=false }={}) {
  const grid = token.parent.grid;
  const { multiplier } = climbingOf(token);
  const cap = movementCap(token);
  const history = historyCosts(token);
  // §412: when forced, the turn budget no longer bounds the climb (the ceiling still does).
  const remaining = (Number.isFinite(cap) && !forced) ? Math.max(0, cap - history.spent - history.excluded) : Infinity;
  const elevation = token._source.elevation ?? 0;
  const { ceiling } = boundsUnder(token);
  // §217: neither beyond the ceiling nor beyond the top of the wall (the climber would have nothing to hold on to and would fall).
  const limit = Math.min(Number.isFinite(ceiling) ? ceiling : Infinity, wallTopFeetOf(token));
  const ceilingCells = Number.isFinite(limit) ? (limit - elevation) / grid.distance : Infinity;
  const max = climbableCells({ remaining, gridDistance: grid.distance, multiplier, ceilingCells });
  return { max, multiplier, cost: multiplier * grid.distance, units: grid.units, ceiling: Number.isFinite(ceiling) ? ceiling : null, remaining };
}

/**
 * §412 (issue #44, batch 5): a rule limit on climbing (not enough movement this turn) — the legality window; true if the player
 * forces (GM and table warned).
 */
const forceClimb = (token, line) => askAnyway(loc("Escalade.TitreForce", { name: token.name }), [line], { actor: token.actor, token });

/** Options of a forced climb step: the move guard does not re-judge it (runtime/move-gate.mjs, `forcedMove`). */
const forcedStep = forced => (forced ? { [MODULE_ID]: { forcedMove: true } } : {});

/**
 * §216: "Grab the edge" — at the edge of a roof, a parapet walk, a floor, the token goes over and ends up
 * hanging on the wall on the void side, head level with the edge (adapter/climb.mjs, `edgesBelowOf`), climbing: it then goes
 * down along the wall. Cost in combat: the height descended at the climbing price, plus the cell (the counterpart of "Pull up").
 * The "house" rules check is due as for climbing.
 */
export async function grabEdge(token, edge, { forced=false }={}) {
  if ( !token?.isOwner || !edge || !climbSystemOn() ) return false;
  const grid = token.parent.grid;
  const feet = token._source.elevation ?? 0;
  const { multiplier, native } = climbingOf(token);
  const cost = ledgeCost({ rise: feet - edge.elevation, multiplier, gridDistance: grid.distance });
  const combatant = combatantFor(token.actor);
  if ( combatant ) {
    const { spent, excluded } = historyCosts(token);
    const left = movementCap(token) - spent - excluded;
    if ( (cost > left + 1e-6) && !forced ) {
      const line = loc("Escalade.HisserPasAssez", { name: token.name, cost: `${cost} ${grid.units}`, left: `${Math.max(0, Math.floor(left * 10) / 10)} ${grid.units}` });
      return (await forceClimb(token, line)) ? grabEdge(token, edge, { forced: true }) : false;
    }
  }
  if ( (climbRules() === "house") && !native && !(await houseCheckPassed(token, CLIMB_DC)) ) return false;
  const mode = token._source.movementAction ?? null;
  const from = token._source.level;
  await token.update({ movementAction: "climb", [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: { from: mode, checkedAt: Date.now() } }, ALTITUDE_OPTIONS);
  await statusSettled(token, true);
  const step = { x: edge.x, y: edge.y, elevation: edge.elevation, action: "displace", ...((edge.level !== from) ? { level: edge.level } : {}) };
  await token.move([step], { [MODULE_ID]: { altitude: true, planned: true, cleared: true, ...(forced ? { forcedMove: true } : {}) }, constrainOptions: { ignoreWalls: true } });
  if ( Math.abs((token._source.elevation ?? 0) - edge.elevation) > 1e-6 ) {
    await token.update({ movementAction: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
    ui.notifications.warn(loc("Escalade.Impossible", { name: token.name }));
    return false;
  }
  if ( combatant ) {
    const budget = readBudget(combatant);
    await writeBudget(combatant, { ...budget, climbed: (Number(budget.climbed) || 0) + cost });
  }
  if ( (token._source.level !== from) && token.parent.isView && (canvas.level?.id === from) && token.object?.controlled ) {
    await token.parent.view({ level: token._source.level, controlledTokens: [token.id] });
  }
  notice(token, loc("Retour.Escalade.Agrippe"), "gain");
  await say({ token }, locEsc("Escalade.SAgrippe", { name: token.name }));
  log(`${token.name}: grabs the edge (${edge.dir}), hangs at ${edge.elevation}, level ${from} → ${token._source.level}${combatant ? `, ${cost} of movement` : ""}`);
  return true;
}

/* -------------------------------------------- */
/*  The "How many cells?" window (§215)          */
/* -------------------------------------------- */

const GAUGE_HEIGHT = 240;   // hauteur de la colonne de cases, en pixels
const GAUGE_WIDTH = 250;   // the left margin carries the level names (§216)

/** Is the top of the wall seen by the climber (light and senses: `perceivedAt`)? Blinded, no; without a canvas, yes. */
function seesTop(token, top) {
  if ( !top ) return true;
  if ( token.actor?.statuses?.has("blinded") ) return false;
  const center = tokenCenter(token);
  const seen = perceivedAt(token, { x: center.x, y: center.y, elevation: top.at });
  return seen ? !seen.blinded : true;
}

/** The gauge model (core/climb.mjs, `climbGauge`) for this climber. */
function gaugeFor(token, room, { down=false }={}) {
  const grid = token.parent.grid;
  const feet = token._source.elevation ?? 0;
  const { top, ceilingFeet, height } = wallTopOf(token);
  const seen = down || seesTop(token, top);
  const model = climbGauge({ feet, ground: groundUnder(token), gridDistance: grid.distance, height, remaining: room.remaining,
    multiplier: room.multiplier, ceilingFeet, top, seen, down, marks: levelMarksAbove(token, feet) });
  return { ...model, feet, ground: groundUnder(token), distance: grid.distance, units: grid.units, height };
}

/** The wall in profile, as SVG: the ground, the cells (selectable or not, chosen), the climber, the top (ledge, ceiling, unknown). */
function gaugeSvg(model, chosen, { down=false }={}) {
  const n = model.cells.length;
  const step = Math.min(34, Math.floor(GAUGE_HEIGHT / Math.max(n + 1, 4)));
  const x = 100, w = 46;
  const base = 20 + ((n + 1) * step);
  const yOf = i => base - (i * step);   // i: rank of the cell above (climbing) or below (descending) the start
  const parts = [];
  const label = (y, text, cls="") => parts.push(`<text x="${x + w + 8}" y="${y}" class="${cls}">${esc(text)}</text>`);
  // Start: for the climb, the climber's cell is at the bottom; for the descent, at the top.
  const start = down ? 20 + step : base;
  const order = down ? model.cells.map((c, i) => ({ ...c, y: start + ((i + 1) * step) - step })) : model.cells.map((c, i) => ({ ...c, y: yOf(i + 1) }));
  // Descent: the start cell (the climber is there), at the top, not clickable.
  if ( down ) {
    parts.push(`<rect class="cell start" x="${x}" y="${22}" width="${w}" height="${step - 4}" rx="3"/>`);
    label(20 + (step / 2) + 4, `${Math.round(model.feet * 10) / 10} ${model.units}`);
  }
  for ( const c of order ) {
    const cls = ["cell", c.choosable ? "reach" : "off", (c.n <= chosen) ? "sel" : ""].join(" ");
    parts.push(`<rect class="${cls}" data-cells="${c.choosable ? c.n : ""}" x="${x}" y="${c.y + 2}" width="${w}" height="${step - 4}" rx="3"/>`);
    label(c.y + (step / 2) + 4, `${Math.round(c.at * 10) / 10} ${model.units}`);
  }
  // The ground (climb: under the column; descent: under the last cell).
  const groundY = down ? 20 + step + (n * step) : base;
  parts.push(`<line class="ground" x1="${x - 18}" y1="${groundY}" x2="${x + w + 8}" y2="${groundY}"/>`);
  label(groundY + 14, loc(down ? "Escalade.Jauge.SolBas" : "Escalade.Jauge.Sol"), "muted");
  // §216: the level separators (even in the open air), at their height — a ledge seen at the same height already carries the name.
  if ( !down ) {
    for ( const m of model.marks ?? [] ) {
      const y = base - (((m.at - model.feet) / model.distance) * step);
      parts.push(`<line class="level" x1="${x - 18}" y1="${y}" x2="${x + w + 4}" y2="${y}"/>`);
      parts.push(`<text x="${x - 20}" y="${y - 3}" text-anchor="end" class="level-text">${esc(m.name)}</text>`);
    }
  }
  // The top: at its true height (the ledge may be below the top of the column); unknown, above the column.
  if ( !down ) {
    // Same scale as the level markers: a height `h` above the starting feet is at `base - (h / case) × pas`.
    const topY = (model.top && !model.hidden) ? (base - (((model.top.at - model.feet) / model.distance) * step) + 2) : (yOf(n) - 2);
    if ( model.hidden ) {
      parts.push(`<rect class="unknown" x="${x - 18}" y="${topY - 22}" width="${w + 36}" height="20" rx="3"/>`);
      parts.push(`<text x="${x + (w / 2)}" y="${topY - 8}" text-anchor="middle" class="unknown-text">?</text>`);
    } else if ( model.top?.kind === "wallEnd" ) {
      parts.push(`<line class="wall-end" x1="${x - 18}" y1="${topY - 4}" x2="${x + w + 18}" y2="${topY - 4}"/>`);
    } else if ( model.top?.kind === "ceiling" ) {
      parts.push(`<rect class="ceiling" x="${x - 18}" y="${topY - 10}" width="${w + 36}" height="8" rx="2"/>`);
    } else if ( model.top?.kind === "ledge" ) {
      parts.push(`<line class="ledge" x1="${x - 18}" y1="${topY - 6}" x2="${x + w + 18}" y2="${topY - 6}"/>`);
    }
  }
  // The climber, on the chosen cell (or at its start).
  const at = chosen ? order.find(c => c.n === chosen) : null;
  const cy = at ? at.y + (step / 2) : (down ? 20 + (step / 2) : base - (step / 2));
  parts.push(`<circle class="climber" cx="${x + (w / 2)}" cy="${cy}" r="${Math.max(6, Math.min(11, (step / 2) - 3))}"/>`);
  const svgHeight = Math.max(base, groundY) + 22;
  return `<svg class="das-climb-gauge" width="${GAUGE_WIDTH}" height="${svgHeight}" viewBox="0 0 ${GAUGE_WIDTH} ${svgHeight}">${parts.join("")}</svg>`;
}

/** The lines to the right of the gauge: target height, what is at the top, cost, fall, "house" rules check. */
function gaugeInfo(token, model, room, chosen, { down=false }={}) {
  const height = down ? (model.feet - (chosen * model.distance)) : (model.feet + (chosen * model.distance));
  const lines = [];
  lines.push(`<p class="aim">${esc(loc(down ? "Escalade.Jauge.Visee" : "Escalade.Jauge.Visee", { height: Math.round(height * 10) / 10, units: model.units, cells: chosen }))}</p>`);
  if ( !down ) {
    const top = model.top;
    const text = model.hidden ? loc("Escalade.Jauge.HautInconnu")
      : (top?.kind === "ledge") ? loc(top.name ? "Escalade.Jauge.Rebord" : "Escalade.Jauge.RebordSansNom", { height: top.at, units: model.units, level: top.name ?? "" })
      : (top?.kind === "ceiling") ? loc("Escalade.Jauge.Plafond", { height: top.at, units: model.units })
      : (top?.kind === "wallEnd") ? loc("Escalade.Jauge.FinDuMur", { height: top.at, units: model.units })
      : loc("Escalade.Jauge.SansPlafond");
    lines.push(`<p><i class="fa-solid ${model.hidden ? "fa-question" : top ? (top.kind === "ledge" ? "fa-stairs" : "fa-arrow-up-from-bracket") : "fa-cloud"}"></i> ${esc(text)}</p>`);
  }
  const cost = chosen * room.cost;
  lines.push(`<p class="muted">${esc(Number.isFinite(room.remaining)
    ? loc("Escalade.Jauge.Cout", { cost, units: model.units, left: room.remaining, factor: room.multiplier })
    : loc("Escalade.Jauge.CoutHorsCombat", { cost, units: model.units, factor: room.multiplier }))}</p>`);
  const fall = fallDice(height - model.ground, (model.units === "m") ? 3 : 10);
  lines.push(`<p class="muted">${esc(fall ? loc("Escalade.Jauge.Chute", { dice: `${fall}d6` }) : loc("Escalade.Jauge.ChuteSansDegats"))}</p>`);
  if ( !down && (climbRules() === "house") && !isClimbing(token) && !climbingOf(token).native ) lines.push(`<p class="warn">${esc(loc("Escalade.Jauge.Test", { dc: CLIMB_DC }))}</p>`);
  if ( model.cells.some(c => !c.choosable) ) lines.push(`<p class="warn">${esc(loc("Escalade.Jauge.Grisees"))}</p>`);
  return lines.join("");
}

/** The "How many cells?" window (`down`: descend): the wall gauge, a cell chosen by a click; null if cancelled. */
async function askCells(token, room, { down=false }={}) {
  const model = gaugeFor(token, room, { down });
  if ( !model.choosable ) return null;
  // Default: up to the top if seen (under the ledge, at the ceiling), down to the ground when descending;
  // otherwise (blind, open sky) one cell.
  let chosen = down ? model.choosable : (model.topCells || 1);
  const render = root => {
    const gauge = root.querySelector(".das-climb-gauge-wrap");
    const info = root.querySelector(".das-climb-info");
    if ( gauge ) gauge.innerHTML = gaugeSvg(model, chosen, { down });
    if ( info ) info.innerHTML = gaugeInfo(token, model, room, chosen, { down });
    const input = root.querySelector("input[name=cells]");
    if ( input ) input.value = String(chosen);
  };
  const content = `<div class="das-climb"><div class="das-climb-gauge-wrap"></div><div class="das-climb-side"><div class="das-climb-info"></div>
    <div class="form-group"><label>${loc("Escalade.Cases")}</label><input type="number" name="cells" min="1" max="${model.choosable}" step="1" value="${chosen}"></div></div></div>`;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc(down ? "Escalade.TitreDescente" : "Escalade.Titre") }, content, rejectClose: false, position: { width: 590 },
    classes: ["dnd5e-combat-climb"],
    render: (event, dialog) => {
      const root = dialog.element;
      render(root);
      root.querySelector(".das-climb-gauge-wrap")?.addEventListener("click", ev => {
        const n = Number(ev.target?.dataset?.cells);
        if ( n >= 1 ) { chosen = n; render(root); }
      });
      root.querySelector("input[name=cells]")?.addEventListener("change", ev => {
        const n = Math.floor(Number(ev.target.value));
        if ( (n >= 1) && (n <= model.choosable) ) { chosen = n; render(root); }
      });
    },
    buttons: [
      { action: "climb", label: loc(down ? "Escalade.Descendre" : "Escalade.Monter"), icon: down ? "fa-solid fa-arrow-down" : "fa-solid fa-mountain", default: true,
        callback: () => chosen },
      { action: "cancel", label: loc("Escalade.Annuler"), icon: "fa-solid fa-xmark" }
    ]
  });
  return Number.isFinite(answer) ? Math.floor(answer) : null;
}

/**
 * The "house" rules check before leaving (wall: DC 15; ceiling: DC 20) — false if the roll fails. Already on the wall,
 * climbing more does not redo the wall check (it is redone each turn); reaching the ceiling does.
 */
async function houseCheckPassed(token, dc) {
  const result = await handleClimbQuery({ token: token.uuid, configure: true, dc });
  if ( result?.success ) return true;
  notice(token, loc("Retour.Escalade.Rate"));
  log(`${token.name}: fails to climb (${result?.total ?? "no roll"} vs DC ${dc})`);
  return false;
}

/**
 * Climb: the requested height (or chosen in the window), the "house" rules check, then `climb` mode and the climb in
 * place. If the core refuses the climb (budget, ceiling, spell wall above), the previous mode is restored.
 * @param {TokenDocument} token
 * `acrobatic` (§195, "Run up the wall"): the monk's Acrobatic Movement — no check, flag `climb.acrobatic`; it will fall if it
 * ends its turn on the wall.
 * @param {{cells?: number|null, acrobatic?: boolean}} [options]  Cells to climb, without a window (scenarios).
 * @returns {Promise<boolean>}
 */
export async function startClimb(token, { cells=null, acrobatic=false, forced=false }={}) {
  if ( !canClimb(token) ) return false;
  if ( acrobatic && (isClimbing(token) || !acrobaticFor(token)) ) return false;
  const room = climbRoom(token, { forced });
  if ( room.max < 1 ) {
    // §412: no more movement this turn — forceable; the ceiling (nothing to climb) is not.
    if ( room.remaining < room.cost ) {
      return (await forceClimb(token, loc("Escalade.PasDeDeplacement", { name: token.name }))) ? startClimb(token, { cells, acrobatic, forced: true }) : false;
    }
    ui.notifications.warn(loc("Escalade.Plafond", { name: token.name }));
    return false;
  }
  const wanted = Number.isFinite(cells) ? Math.floor(cells) : await askCells(token, room);
  if ( !(wanted >= 1) ) return false;
  const n = Math.min(wanted, room.max);
  // §215: the top was not seen — more may have been requested than the ceiling allows: the climb stops there.
  if ( wanted > room.max ) notice(token, loc("Escalade.Bute"), "refused");
  const already = isClimbing(token);   // already on the wall: climb further, without a new check (it is redone each turn)
  if ( !already && !acrobatic && (climbRules() === "house") && !climbingOf(token).native && !(await houseCheckPassed(token, CLIMB_DC)) ) return false;
  const grid = token.parent.grid;
  const from = token._source.elevation ?? 0;
  const mode = token._source.movementAction ?? null;
  if ( !already ) {
    const flag = { from: mode, checkedAt: Date.now(), ...(acrobatic ? { acrobatic: true } : {}) };
    await token.update({ movementAction: "climb", [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: flag }, ALTITUDE_OPTIONS);
    // The status (and its immunity to falling) before the climb: placed by the active GM (`updateToken`, the only one to write it —
    // two clients writing it stepped on each other); we wait for it, otherwise dnd5e would make the climber "Falling" between
    // the climb and the status.
    await statusSettled(token, true);
  }
  await token.move([{ elevation: from + (n * grid.distance), action: "climb" }], { ...walkOptions(), ...forcedStep(forced) });
  // §217: a climb that crosses a level limit (20 ft: First → Second Floor) ends in two steps in the core — judged too
  // early, it looked refused: the mode was restored, the climber stayed in the air and fell.
  await elevationSettled(token, from);
  if ( Math.abs((token._source.elevation ?? 0) - from) < 1e-6 ) {
    if ( !already ) await token.update({ movementAction: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
    ui.notifications.warn(loc("Escalade.Impossible", { name: token.name }));
    return false;
  }
  notice(token, loc("Retour.Escalade.Grimpe"), "gain");
  log(`${token.name}: ${climbFlag(token)?.acrobatic ? "runs up the wall" : "climbs"} ${n} cell(s), ${from} → ${token._source.elevation} (${climbRules()}, ×${room.multiplier})`);
  return true;
}

/* -------------------------------------------- */
/*  Le plafond (lot 2)                          */
/* -------------------------------------------- */

/**
 * Can this token reach the ceiling: its own, on the wall (climbing) or on the ground near a wall, a ceiling above it, the
 * capability (§192.3) or the "house" rules (DC 20), neither Grappled nor without speed, not already on the ceiling.
 */
export function canClimbCeiling(token) {
  if ( !token?.isOwner || !concerned(token) || isOnCeiling(token) ) return false;
  if ( !isClimbing(token) && (placementOf(token.movementAction) !== "ground") ) return false;
  if ( isGrappled(token) || climbFallReasonFor(token) ) return false;
  if ( !isClimbing(token) && !wallsNear(token).length ) return false;   // from the ground, climb along a wall
  if ( !canWalkCeilingsAt(token) && (climbRules() !== "house") ) return false;   // §195: not through Slippers on a slippery surface
  return ceilingPerchFor(token) !== null;
}

/**
 * What is needed to reach the ceiling from here: the perch (feet), the cells to climb, and whether the turn budget pays for them.
 * @returns {{perch: number, cells: number, affordable: boolean, room: object}|null}
 */
export function ceilingRoom(token, { forced=false }={}) {
  const perch = ceilingPerchFor(token);
  if ( perch === null ) return null;
  const grid = token.parent.grid;
  const room = climbRoom(token, { forced });
  const cells = Math.max(0, Math.ceil(((perch - (token._source.elevation ?? 0)) / grid.distance) - 1e-6));
  return { perch, cells, affordable: cells <= room.max, room };
}

/**
 * "Climb the ceiling": the "house" rules check (DC 20, without the capability), the `climb` mode (from the ground), the climb
 * up to the ceiling minus the token's height, then the `climb.ceiling` flag — the active GM then places the "On the ceiling"
 * status and flips the token. Refused by the core (budget, ceiling), everything is restored.
 * @returns {Promise<boolean>}
 */
export async function climbToCeiling(token, { forced=false }={}) {
  if ( !canClimbCeiling(token) ) return false;
  const need = ceilingRoom(token, { forced });
  if ( !need ) return false;
  if ( !need.affordable ) {
    return (await forceClimb(token, loc("Escalade.PasDeDeplacement", { name: token.name }))) ? climbToCeiling(token, { forced: true }) : false;
  }
  if ( (climbRules() === "house") && !canWalkCeilingsAt(token) && !(await houseCheckPassed(token, CEILING_DC)) ) return false;
  const already = isClimbing(token);
  const from = token._source.elevation ?? 0;
  const mode = token._source.movementAction ?? null;
  if ( !already ) {
    await token.update({ movementAction: "climb", [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: { from: mode, checkedAt: Date.now() } }, ALTITUDE_OPTIONS);
    await statusSettled(token, true);
  }
  if ( need.cells > 0 ) await token.move([{ elevation: need.perch, action: "climb" }], { ...walkOptions(), ...forcedStep(forced) });
  if ( Math.abs((token._source.elevation ?? 0) - need.perch) > 1e-6 ) {
    if ( !already ) await token.update({ movementAction: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
    ui.notifications.warn(loc("Escalade.Impossible", { name: token.name }));
    return false;
  }
  const { acrobatic: _run, ...kept } = climbFlag(token) ?? { from: mode };   // on the ceiling, no more running on the wall
  await token.update({ [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: { ...kept, checkedAt: Date.now(), ceiling: true } }, ALTITUDE_OPTIONS);
  await statusSettled(token, true);
  notice(token, loc("Retour.Escalade.AuPlafond"), "gain");
  log(`${token.name}: reaches the ceiling (${from} → ${need.perch}, ${climbRules()})`);
  return true;
}

/** Can this climber (on wall or ceiling) go back down along a wall: its own, climbing, above the ground, near a wall. */
export function canClimbDown(token) {
  if ( !token?.isOwner || !concerned(token) || !isClimbing(token) || !aboveGround(token) ) return false;
  if ( isGrappled(token) || climbFallReasonFor(token) ) return false;
  return wallsNear(token).length > 0;
}

/** What this climber can descend now: cells at most (turn budget, height above the ground), cost per cell. */
export function descentRoom(token, { forced=false }={}) {
  const grid = token.parent.grid;
  const room = climbRoom(token, { forced });
  const height = Math.max(0, (token._source.elevation ?? 0) - groundUnder(token));
  const max = climbableCells({ remaining: room.remaining, gridDistance: grid.distance, multiplier: room.multiplier, ceilingCells: height / grid.distance });
  return { ...room, max };
}

/**
 * "Climb down the wall": from the ceiling (the `ceiling` flag drops first: status and mirror restored by the active GM) or
 * from the wall, N cells down in `climb`, paid like the climb; back on the ground, the active GM restores the previous mode.
 * @param {TokenDocument} token
 * @param {{cells?: number|null}} [options]
 * @returns {Promise<boolean>}
 */
export async function climbDown(token, { cells=null, forced=false }={}) {
  if ( !canClimbDown(token) ) return false;
  const room = descentRoom(token, { forced });
  if ( room.max < 1 ) {
    if ( forced || !(room.remaining < room.cost) ) return false;   // nothing to descend
    return (await forceClimb(token, loc("Escalade.PasDeDeplacement", { name: token.name }))) ? climbDown(token, { cells, forced: true }) : false;
  }
  const wanted = Number.isFinite(cells) ? Math.floor(cells) : await askCells(token, room, { down: true });
  if ( !(wanted >= 1) ) return false;
  const n = Math.min(wanted, room.max);
  const grid = token.parent.grid;
  const from = token._source.elevation ?? 0;
  if ( isOnCeiling(token) ) {
    await token.update({ [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: { ...(climbFlag(token) ?? {}), ceiling: false } }, ALTITUDE_OPTIONS);
    await statusSettled(token, true);
  }
  await token.move([{ elevation: from - (n * grid.distance), action: "climb" }], { ...walkOptions(), ...forcedStep(forced) });
  await elevationSettled(token, from);
  if ( Math.abs((token._source.elevation ?? 0) - from) < 1e-6 ) {
    ui.notifications.warn(loc("Escalade.Impossible", { name: token.name }));
    return false;
  }
  log(`${token.name}: climbs down ${n} cell(s), ${from} → ${token._source.elevation}`);
  return true;
}

/**
 * §209: pull up from the wall onto a ledge (roof, parapet walk, floor) — the neighbouring cell whose floor is within head reach
 * (`ledgesOf`). The token steps there with a `displace` step (over the top of the wall: neither walls nor Surfaces stop it),
 * onto the level of that floor (the floor at 20 ft of a level 0-20 is the bottom of the next); in combat, the remaining height
 * at the climbing price plus one cell (`ledgeCost`), counted against the budget (`climbed`, like a staircase). Then the ground
 * mode, the climb flag removed, and the view follows the token to the floor. On its owner's client.
 * @param {TokenDocument} token
 * @param {{dir: string, x: number, y: number, ground: number, rise: number, level: string}} ledge
 */
export async function hoistOnto(token, ledge, { forced=false }={}) {
  if ( !token?.isOwner || !ledge || !climbSystemOn() ) return false;
  const grid = token.parent.grid;
  const cost = ledgeCost({ rise: ledge.rise, multiplier: climbingOf(token).multiplier, gridDistance: grid.distance });
  const combatant = combatantFor(token.actor);
  if ( combatant ) {
    const { spent, excluded } = historyCosts(token);
    const left = movementCap(token) - spent - excluded;
    if ( (cost > left + 1e-6) && !forced ) {
      const line = loc("Escalade.HisserPasAssez", { name: token.name, cost: `${cost} ${grid.units}`, left: `${Math.max(0, Math.floor(left * 10) / 10)} ${grid.units}` });
      return (await forceClimb(token, line)) ? hoistOnto(token, ledge, { forced: true }) : false;
    }
  }
  const from = token._source.level;
  const step = { x: ledge.x, y: ledge.y, elevation: ledge.ground, action: "displace", ...((ledge.level !== from) ? { level: ledge.level } : {}) };
  await token.move([step], { [MODULE_ID]: { altitude: true, planned: true, cleared: true, ...(forced ? { forcedMove: true } : {}) }, constrainOptions: { ignoreWalls: true } });
  if ( Math.abs((token._source.elevation ?? 0) - ledge.ground) > 1e-6 ) {
    ui.notifications.warn(loc("Escalade.Impossible", { name: token.name }));
    return false;
  }
  if ( combatant ) {
    const budget = readBudget(combatant);
    await writeBudget(combatant, { ...budget, climbed: (Number(budget.climbed) || 0) + cost });
  }
  await token.update({ movementAction: groundModeFor(token), [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
  if ( (token._source.level !== from) && token.parent.isView && (canvas.level?.id === from) && token.object?.controlled ) {
    await token.parent.view({ level: token._source.level, controlledTokens: [token.id] });
  }
  notice(token, loc("Retour.Escalade.Hisse"));
  await say({ token }, locEsc("Escalade.SeHisse", { name: token.name }));
  log(`${token.name}: hoists up onto the ledge (${ledge.dir}, ${ledge.rise} up, level ${from} → ${token._source.level}, ${combatant ? `${cost} of movement` : "out of combat"})`);
  return true;
}

/**
 * The vertical mirror of a token on the ceiling, held by the active GM (§192.4 point 8): `texture.scaleY` inverted on reaching the
 * ceiling (the original scale kept in `flags.dnd5e-combat.ceilingFlip`), restored as soon as it is no longer there (descent, fall,
 * mode changed) — only if the token does not already turn while walking: core automatic rotation off (`core.tokenAutoRotate`, §246)
 * or rotation locked on the token. Queued per token: two updates in a row do not write it at the same time.
 */
const syncFlip = token => enqueue(`climb-flip:${token.uuid}`, async () => {
  const kept = token.getFlag(MODULE_ID, FLIP_FLAG) ?? null;
  const turns = (game.settings.get("core", "tokenAutoRotate") === true) && !token.lockRotation;
  const wanted = isOnCeiling(token) && !turns;
  if ( wanted && !kept ) {
    const scaleY = token._source.texture?.scaleY ?? 1;
    await token.update({ "texture.scaleY": flippedScale(scaleY), [`flags.${MODULE_ID}.${FLIP_FLAG}`]: { scaleY } }, ALTITUDE_OPTIONS);
    log(`${token.name}: upside down on the ceiling (scaleY ${scaleY} → ${flippedScale(scaleY)})`);
  }
  else if ( !wanted && kept ) {
    await token.update({ "texture.scaleY": Number(kept.scaleY) || 1, [`flags.${MODULE_ID}.${FLIP_FLAG}`]: null }, ALTITUDE_OPTIONS);
    log(`${token.name}: back the right way up (scaleY ${kept.scaleY})`);
  }
}).catch(err => console.error(`${MODULE_ID} | ceiling flip`, err));

/**
 * A player on the ceiling does not leave from under the ceiling by walking (2024 rules: it stays hanging as long as there is a
 * ceiling; in "house" mode, it leaves and falls — `onTokenUpdated`). Engine moves (`altitude`, `forced`), teleports, the
 * fall and the GM pass.
 */
function onPreMoveToken(token, movement, operation) {
  if ( !isClimbing(token) || !concerned(token) ) return true;
  const flags = operation?.[MODULE_ID] ?? continuedFlags(token, movement);
  if ( flags?.altitude || flags?.forced || flags?.forcedMove || operation?.isUndo || game.user.isGM || (climbRules() === "house") ) return true;
  const walking = w => !CONFIG.Token.movement.actions[w.action]?.teleport && !["displace", "fall"].includes(w.action);
  const steps = movement.pending.waypoints.filter(walking);
  // §196: on the wall, no step away from the wall (in the air) — it climbs down or lets go, as on the ceiling.
  if ( !isOnCeiling(token) ) {
    if ( !steps.some(w => !holdsWallAt(token, positionOf(w))) ) return true;
    // §412: the legality window; when forced, the same path starts again (`forcedMove`).
    notice(token, loc("Retour.Escalade.MurFini"));
    forceMoveLater(token, movement, [{ key: "wallEnds", line: loc("Escalade.MurFini", { name: token.name }) }]);
    return false;
  }
  const off = steps.find(w => !hangsAt(token, positionOf(w)));
  // §195: one who holds on to the ceiling only through Slippers does not advance over a slippery surface.
  const slips = !off && steps.find(w => !canWalkCeilingsAt(token, positionOf(w)));
  if ( !off && !slips ) return true;
  const key = off ? "PlafondFini" : "Glissant";
  notice(token, loc(`Retour.Escalade.${key}`));
  forceMoveLater(token, movement, [{ key: `ceiling.${key}`, line: loc(`Escalade.${key}`, { name: token.name }) }]);
  return false;
}

/**
 * §196: does a climber on the wall hold at this position (waypoint): a climbable wall touches it, or the ground rises up to it.
 * The same judgment as the A* (adapter/path-world.mjs `wallHolds`).
 */
function holdsWallAt(token, pos) {
  const elevation = pos.elevation ?? token._source.elevation ?? 0;
  if ( elevation <= groundUnder(token, pos) + 1e-6 ) return true;
  return wallsNear(token, { ...pos, elevation }).length > 0;
}

/* -------------------------------------------- */
/*  Tomber, atterrir                            */
/* -------------------------------------------- */

/** The ground mode a climber resumes: the one from before the climb (a flight granted in between: walking). */
function groundModeFor(token) {
  const from = climbFlag(token)?.from ?? null;
  if ( ["air", "under"].includes(placementOf(from)) ) return groundModeOf(token.actor);
  return from;
}

/** The end of the token's move animation (at most `ms`), else it is stopped: the visual elevation reaches the source. */
async function settleAnimation(token, ms=5000) {
  const animation = token.object?.movementAnimationPromise;
  if ( animation ) await Promise.race([animation, new Promise(resolve => setTimeout(resolve, ms))]);
  if ( Math.abs((token.elevation ?? 0) - (token._source.elevation ?? 0)) > 1e-6 ) token.object?.stopAnimation?.();
}

/**
 * dnd5e's fall: `updateFalling` places the "Falling" condition from the surface under the token and its speeds, then `plummet`
 * makes it fall to that surface and posts the damage card (1d6 per 10 ft; the engine applies it, `onFallCard`, hence Prone).
 * True if the token fell. On a client that can modify the token. Also used for Reverse Gravity (§195).
 */
export async function fallLikeDnd5e(token) {
  if ( !climbSystemOn() || isEthereal(token) ) return false;   // §224: system off — no engine fall; §225: nor in the Ethereal
  // §208: one fall at a time per token — climbing and the automatic fall (runtime/falls.mjs) may both request it
  // (two `plummet` at once: two damage cards).
  if ( plummeting.has(token.uuid) ) return false;
  plummeting.add(token.uuid);
  try { return await plummetOnce(token); }
  finally { plummeting.delete(token.uuid); }
}
const plummeting = new Set();

async function plummetOnce(token) {
  if ( typeof token.updateFalling === "function" ) await token.updateFalling();
  if ( !token.actor?.statuses?.has("falling") || (typeof token.plummet !== "function") ) return false;
  // `plummet` measures the fall from the token's VISUAL elevation (documents/token.mjs: `this.elevation`, which follows the
  // animation): dropped right after the climb, the token was visually only at 1.5 ft and the fall did no damage (seen on
  // 2026-10-17). We wait for the current animation to end (never in a hidden tab: at most 5 s, then it is stopped).
  await settleAnimation(token);
  // Survey of the gaps (2026-10-23): window in the background, a climb's animation does not progress, and stopping it freezes
  // the token at the DISPLAYED height (0 for a 15 ft climb) — `plummet` then sees nothing to fall (seen on returning from the
  // Ethereal in the air). Without a correct displayed height, the fall is not handed to dnd5e: the caller falls from the real
  // height (runtime/falls.mjs).
  if ( Math.abs((token.elevation ?? 0) - (token._source.elevation ?? 0)) > 1e-6 ) return false;
  await token.plummet();   // dnd5e itself removes "Falling" after the fall movement (`_onUpdateMovement`)
  return true;
}

/**
 * The climber lets go of the wall: its previous mode, then dnd5e's fall if it is in the air (`updateFalling` places the "Falling"
 * condition from the surface under it and its speeds; `plummet` makes it fall, damage included). A creature that flies stays in
 * the air, flying. On a client that can modify the token (its owner, the GM).
 */
async function letGo(token) {
  const mode = groundModeFor(token);
  // Made Prone, the token is already in crawl mode (runtime/prone.mjs, same hook, order free): we keep crawl, and the mode that
  // the survey will restore is the one from before the climb, not `climb`.
  const crawling = token._source.movementAction === "crawl";
  const changes = crawling
    ? { [`flags.${MODULE_ID}.crawl.from`]: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }
    : { movementAction: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null };
  await token.update(changes, { [MODULE_ID]: { altitude: true, forced: true } });
  // The status must be gone before the fall: it carries the immunity, dnd5e would not make the climber fall with it (the active GM
  // removes it on the token update: mode or flag).
  await statusSettled(token, false);
  if ( !aboveGround(token) ) return "ground";
  if ( await fallLikeDnd5e(token) ) return "fell";
  if ( !modeRefusalFor(token.actor, "fly") ) {
    await token.update({ movementAction: "fly" }, ALTITUDE_OPTIONS);
    return "flies";
  }
  return "stays";
}

/** "Let go" (menu): voluntary fall. */
export async function dropDown(token) {
  if ( !token?.isOwner || !isClimbing(token) || !climbSystemOn() ) return false;
  const ceiling = isOnCeiling(token);
  const outcome = await letGo(token);
  if ( outcome === "fell" ) await say({ token }, locEsc(ceiling ? "Escalade.SeLaisseTomberPlafond" : "Escalade.SeLaisseTomber", { name: token.name }));
  log(`${token.name}: lets go of the ${ceiling ? "ceiling" : "wall"} (${outcome})`);
  return true;
}

/** Tokens currently falling: the same effect (Prone) goes through several hooks, the fall plays only once. */
const falling = new Set();

/** §208: is climbing making this token fall right now? The automatic fall (runtime/falls.mjs) then stands aside. */
export const climbFallInProgress = token => falling.has(token?.id) || plummeting.has(token?.uuid);

/** A climber that no longer holds (Prone, Incapacitated, Grappled, no speed, no ceiling) or that fails its check falls. Active GM. */
async function fall(token, reason) {
  if ( falling.has(token.id) ) return;
  falling.add(token.id);
  try {
    notice(token, loc("Retour.Escalade.Tombe"));
    const ceiling = isOnCeiling(token);
    const outcome = await letGo(token);
    await say({ token }, locEsc(ceiling ? "Escalade.ChutePlafond" : "Escalade.Chute", { name: token.name, reason: loc(`Escalade.Raison.${reason}`) }));
    log(`${token.name}: falls off the ${ceiling ? "ceiling" : "wall"} (${reason}: ${outcome})`);
  } finally { falling.delete(token.id); }
}

/** A climber: in `climb` mode, or already switched to crawl mode by Prone but still on the wall (the climb flag is there). */
const climber = token => isClimbing(token) || !!climbFlag(token);

/** The climbers of this actor that no longer hold to the wall fall. Active GM. */
async function checkClimbers(actor) {
  for ( const token of tokensOf(actor) ) {
    if ( !climber(token) || !concerned(token) ) continue;
    const reason = climbFallReasonFor(token);
    if ( reason ) await fall(token, reason);
  }
}

/** The grip statuses the engine holds: "Climbing" on the wall, "On the ceiling" on the ceiling (never both). */
const HOLD_STATUSES = [MODE_STATUSES.climbing.id, MODE_STATUSES.ceiling.id];
const holds = token => HOLD_STATUSES.some(id => token.actor?.statuses?.has(id));

/**
 * The "Climbing" / "On the ceiling" statuses follow the mode and the flag — written by the active GM only, queued per actor:
 * two updates in a row (Prone's crawl mode, the flag removed by the fall) do not remove the same effect at the same time
 * ("ActiveEffect … does not exist"). The incoming status is placed BEFORE the other leaves: between the two, the climber would
 * otherwise be briefly without immunity to "Falling", which dnd5e re-evaluates on every effect change.
 */
const syncStatus = token => enqueue(`climb-status:${token.actor?.uuid}`, async () => {
  const climbing = isClimbing(token);
  const wanted = { [MODE_STATUSES.climbing.id]: climbing && !isOnCeiling(token), [MODE_STATUSES.ceiling.id]: climbing && isOnCeiling(token) };
  for ( const [id, on] of Object.entries(wanted) ) if ( on ) await setStatus(token.actor, id, true);
  for ( const [id, on] of Object.entries(wanted) ) if ( !on ) await setStatus(token.actor, id, false);
}).catch(() => {});

/** The climber's client waits for the active GM to place (or remove) a grip status — at most `ms`; without an active GM, no waiting. */
async function statusSettled(token, wanted, ms=3000) {
  if ( !game.users.activeGM ) return false;
  const until = Date.now() + ms;
  const settled = () => wanted ? (holds(token) && (token.actor?.statuses?.has(MODE_STATUSES.ceiling.id) === isOnCeiling(token))) : !holds(token);
  while ( !settled() && (Date.now() < until) ) await new Promise(resolve => setTimeout(resolve, 50));
  return settled();
}

/**
 * Active GM, on every token update: the statuses and the mirror follow the mode and the flag; a climber back on the ground
 * (climbed down the wall) resumes its previous mode; a ceiling walker who arrives where there is no ceiling at its height
 * (slid by the GM, or exited in "house" mode) falls.
 */
async function onTokenUpdated(token, changes) {
  if ( !token.actor || !concerned(token) ) return;
  const moved = ["x", "y", "elevation", "level"].some(k => k in changes);
  const flagged = ("movementAction" in changes) || (changes.flags?.[MODULE_ID] && (CLIMB_FLAG in changes.flags[MODULE_ID]));
  if ( flagged ) {
    await syncStatus(token);
    await syncFlip(token);
  }
  if ( moved && isClimbing(token) && !aboveGround(token) ) {
    await token.update({ movementAction: groundModeFor(token), [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
    log(`${token.name}: back on the ground, climbing over`);
    return;
  }
  // §196: slid away from the wall by the GM (or in "house" mode), the climber lets go.
  if ( moved && isClimbing(token) && !isOnCeiling(token) && !holdsWallAt(token, positionOf(token._source)) ) await fall(token, "noWall");
  else if ( moved && isOnCeiling(token) && !hangsAt(token) ) await fall(token, "noCeiling");
  // §195: 2024 rules, on the ceiling only through Slippers above a slippery surface (slid there by the GM): it falls. In
  // "house" mode, it stays — the DC 20 is then due, as for one without the capability (`checkWanted`).
  else if ( moved && isOnCeiling(token) && (climbRules() !== "house") && !canWalkCeilingsAt(token) ) await fall(token, "slippery");
}

/**
 * dnd5e's fall damage card (`postFallDamage`, rules/falling.mjs:36: `flags.dnd5e.context.fall`, targets in
 * `system.targets`) applies nothing by itself — it is the GM's damage tray. The engine applies it to the targets, through
 * `applyDamage` with the card as origin: dnd5e then reads its context and makes them Prone (`applyFallProne`, attributes.mjs:684).
 * Active GM, once per card.
 */
async function onFallCard(message) {
  if ( message.getFlag("dnd5e", "context")?.fall !== true || message.getFlag(MODULE_ID, "fallApplied") ) return;
  const targets = Array.from(message.system?.targets ?? []);
  const damages = (message.rolls ?? []).filter(r => Number.isFinite(r.total)).map(r => ({ value: r.total, type: r.options?.type ?? "bludgeoning" }));
  if ( !targets.length || !damages.length ) return;
  await message.setFlag(MODULE_ID, "fallApplied", true);
  await waitForDice(message);
  for ( const target of targets ) {
    // A dnd5e target descriptor carries the token's uuid (`uuid`) — or, depending on the version, under `token`.
    const doc = fromUuidSync(target.uuid ?? target.token ?? "", { strict: false });
    const actor = (doc?.documentName === "Actor") ? doc : (doc?.actor ?? null);
    if ( !actor ) continue;
    // §301: before the damage, the fall reactions (Slow Fall: reduced; Feather Fall: cancelled, not Prone).
    const token = (doc?.documentName === "Token") ? doc : (actor.getActiveTokens?.(false, true)?.[0] ?? null);
    const total = damages.reduce((sum, d) => sum + d.value, 0);
    const reacted = token ? await askFallReactions(token, total) : { reduce: 0, cancel: false, by: [] };
    if ( reacted.cancel ) { log(`${actor.name}: no fall damage (${reacted.by.join(", ")})`); continue; }
    const left = Math.max(0, total - reacted.reduce);
    const applied = reacted.reduce ? [{ value: left, type: damages[0].type }] : damages;
    if ( reacted.reduce ) log(`${actor.name}: fall damage reduced by ${reacted.reduce} (${reacted.by.join(", ")})`);
    await actor.applyDamage(applied, { origin: message });
    log(`${actor.name}: fall damage applied (${applied.map(d => d.value).join(" + ")})`);
  }
}

/* -------------------------------------------- */
/*  The "house" rules check                     */
/* -------------------------------------------- */

/**
 * On the climber's side: the Strength (Athletics) check — DC 15 on the wall, DC 20 on the ceiling —, in dnd5e's roll window
 * (where the interface offers its aids, §113); closed or on timeout, rolled without a window. Returns `{ total, success }`, or
 * null without a roll.
 */
export async function handleClimbQuery({ token: uuid, configure=true, dc=CLIMB_DC }, { user=null }={}) {
  // §472: only the GM sends this request in play; from a player, it is dropped (security refusal, not forceable).
  if ( !fromTrusted(user) ) { console.warn(`${MODULE_ID} | climb query from ${user.name} refused: only a GM sends it`); return null; }
  const token = await fromUuid(uuid);
  const actor = token?.actor;
  if ( !actor ) return null;
  ui.notifications.info(loc((dc === CEILING_DC) ? "Escalade.TestPlafond" : "Escalade.Test", { name: token.name, dc }));
  const cancel = configure ? closeRollDialogAfter(actor, () => {}, null, { awaiting: "roll" }) : () => {};
  let rolls = await actor.rollSkill({ skill: "ath", ability: "str", target: dc }, { configure });
  cancel();
  if ( !rolls?.length && configure ) rolls = await actor.rollSkill({ skill: "ath", ability: "str", target: dc }, { configure: false });
  const total = rolls?.[0]?.total;
  return Number.isFinite(total) ? { total, success: total >= dc } : null;
}

const busy = new Set();

/** The DC of this climber's periodic check: 20 on the ceiling, 15 on the wall. */
const checkDcOf = token => (isOnCeiling(token) ? CEILING_DC : CLIMB_DC);

/** Active GM: the check asked of the player who owns the climber (on their side), else rolled here; a failure makes it fall. */
async function requestClimbCheck(token) {
  if ( busy.has(token.id) ) return;
  busy.add(token.id);
  try {
    await token.setFlag(MODULE_ID, CLIMB_FLAG, { ...(climbFlag(token) ?? {}), checkedAt: Date.now() });
    const dc = checkDcOf(token);
    const userId = rollerFor(token.actor);
    const user = userId ? game.users.get(userId) : null;
    let result = null;
    if ( user && !user.isSelf ) result = await queryPlayer(user, CLIMB_QUERY, { token: token.uuid, dc },
      { timeout: CHECK_TIMEOUT_MS, actor: token.actor, label: waitLabel("Escalade", { dc }) }).catch(() => null);
    if ( !result ) result = await handleClimbQuery({ token: token.uuid, configure: false, dc });
    if ( !isClimbing(token) ) return;
    if ( result && !result.success ) await fall(token, "check");
    else log(`${token.name}: holds on to the ${isOnCeiling(token) ? "ceiling" : "wall"} (${result?.total ?? "no roll"} vs DC ${dc})`);
  } finally { busy.delete(token.id); }
}

/**
 * Is the check due for this climber ("house" rules)? Not with a real climbing speed; on the ceiling, not either with the
 * capability to walk there (Spider Climb, Slippers…).
 */
const checkWanted = token => (climbRules() === "house") && isClimbing(token) && concerned(token) && !climbingOf(token).native
  && !climbFlag(token)?.acrobatic && !(isOnCeiling(token) && canWalkCeilingsAt(token));

/**
 * Turn change, active GM: the monk who ended their turn running up the wall falls (§195, Acrobatic Movement: "during
 * your turn"); then a climber's turn starts: its check ("house" rules).
 */
async function onTurnChange(combat, prior) {
  const ended = prior?.combatantId ? combat.combatants.get(prior.combatantId)?.token : null;
  if ( ended && concerned(ended) && acrobaticFallDue({ acrobatic: !!climbFlag(ended)?.acrobatic, climbing: isClimbing(ended),
    aboveGround: aboveGround(ended), onCeiling: isOnCeiling(ended) }) ) await fall(ended, "acrobatic");
  const token = combat.combatant?.token;
  if ( !token || !checkWanted(token) ) return;
  await requestClimbCheck(token);
}

/** Out of combat, every 10 s. Active GM, displayed scene. */
function tick() {
  if ( theaterActive() || !isExecutor() || !canvas?.ready || game.combat?.started || (climbRules() !== "house") ) return;
  for ( const token of canvas.scene?.tokens ?? [] ) {
    if ( !checkWanted(token) || !climbCheckDue(climbFlag(token)?.checkedAt, Date.now(), CLIMB_CHECK_SECONDS * 1000) ) continue;
    requestClimbCheck(token).catch(err => console.error(`${MODULE_ID} | climb check`, err));
  }
}

/* -------------------------------------------- */

/**
 * The entries of one's own token menu: "Climb the wall" near a wall, "Run up the wall" for the monk (§195), "Climb the
 * ceiling" under a ceiling (capability or house rules), "Climb down the wall" while climbing near a wall, "Let go" while
 * climbing.
 */
export function climbEntries(token) {
  return whileClimbSystem(() => entriesOf(token));   // §224: nothing when the system is off
}

function entriesOf(token) {
  const entries = [];
  if ( canClimb(token) ) entries.push({ icon: "fa-solid fa-mountain", label: loc("Menu.Grimper"), run: () => startClimb(token) });
  if ( canClimb(token) && !isClimbing(token) && acrobaticFor(token) ) {
    entries.push({ icon: "fa-solid fa-person-running", label: loc("Menu.CourirMur"), run: () => startClimb(token, { acrobatic: true }) });
  }
  if ( canClimbCeiling(token) ) entries.push({ icon: "fa-solid fa-spider", label: loc("Menu.GrimperPlafond"), run: () => climbToCeiling(token) });
  if ( canClimbDown(token) ) entries.push({ icon: "fa-solid fa-arrow-down", label: loc("Menu.DescendreMur"), run: () => climbDown(token) });
  // §209: pull up onto a ledge within reach — one entry per direction when there are several.
  if ( token?.isOwner ) {
    const ledges = ledgesOf(token);
    for ( const ledge of ledges ) {
      const label = (ledges.length > 1) ? loc("Menu.SeHisserVers", { dir: loc(`Escalade.Dir.${ledge.dir}`) }) : loc("Menu.SeHisser");
      entries.push({ icon: "fa-solid fa-person-through-window", label, run: () => hoistOnto(token, ledge) });
    }
  }
  // §216: grab the edge to descend — one entry per direction when there are several.
  if ( token?.isOwner && concerned(token) && !isGrappled(token) && !climbFallReasonFor(token) ) {
    const edges = edgesBelowOf(token);
    for ( const edge of edges ) {
      const label = (edges.length > 1) ? loc("Menu.SAgripperVers", { dir: loc(`Escalade.Dir.${edge.dir}`) }) : loc("Menu.SAgripper");
      entries.push({ icon: "fa-solid fa-person-arrow-down-to-line", label, run: () => grabEdge(token, edge) });
    }
  }
  if ( token?.isOwner && isClimbing(token) ) entries.push({ icon: "fa-solid fa-person-falling", label: loc("Menu.SeLaisserTomber"), run: () => dropDown(token) });
  return entries;
}

/* -------------------------------------------- */
/*  API publique (§196, lot 4 : les voisins)    */
/* -------------------------------------------- */

const docOf = token => token?.document ?? token ?? null;

/**
 * §196: a token's climbing state, for an interface or an AI — what the engine holds (mode, flag, status) and what its menu
 * would offer now. null without token or actor.
 * @param {Token|TokenDocument} token
 * @returns {{climbing: boolean, onCeiling: boolean, acrobatic: boolean, elevation: number, height: number, units: string,
 *   speed: number, native: boolean, multiplier: number, walksCeilings: boolean, enabled: boolean, rules: "2024"|"house",
 *   canClimb: boolean, canRun: boolean, canCeiling: boolean, canDown: boolean, canDrop: boolean}|null}
 */
export function climbStateOf(token) {
  const doc = docOf(token);
  if ( !doc?.actor || !doc.parent?.grid ) return null;
  const climbing = isClimbing(doc);
  const speeds = climbingOf(doc);
  const elevation = doc._source.elevation ?? 0;
  let ground = elevation;
  try { ground = groundUnder(doc); } catch { /* scene without levels or surfaces: the ground is where it is */ }
  return {
    climbing, onCeiling: isOnCeiling(doc), acrobatic: climbing && (climbFlag(doc)?.acrobatic === true),
    elevation, height: Math.max(0, elevation - ground), units: doc.parent.grid.units,
    speed: speeds.speed ?? 0, native: !!speeds.native, multiplier: speeds.multiplier ?? 1, walksCeilings: canWalkCeilings(doc.actor),
    enabled: climbSystemOn(),   // §224: the GM's switch; off, every `can…` is false and `ledges` is empty
    rules: climbRules(), canClimb: canClimb(doc), canRun: canClimb(doc) && !climbing && acrobaticFor(doc),
    canCeiling: canClimbCeiling(doc), canDown: canClimbDown(doc), canDrop: !!doc.isOwner && climbing && climbSystemOn(),
    // §209: the ledges it can pull up onto (direction, floor, height to climb, arrival level).
    ledges: whileClimbSystem(() => ledgesOf(doc)).map(({ dir, ground, rise, level }) => ({ dir, ground, rise, level }))
  };
}

/**
 * §196: would this climber hold on this cell (top-left corner, at its height) — on the wall, a climbable wall touches it; on the
 * ceiling, the ceiling is there at its height (and does not slip under Slippers)? Always true for one who is not climbing. For a
 * cell-by-cell walk (gamepad): the engine's A* applies the same judgment.
 * @param {Token|TokenDocument} token
 * @param {{i: number, j: number}} cell
 */
export function climbHoldsAt(token, cell) {
  const doc = docOf(token);
  if ( !doc || !isClimbing(doc) || !cell ) return true;
  const pos = { ...doc.parent.grid.getTopLeftPoint(cell), elevation: doc._source.elevation ?? 0, level: doc._source.level };
  if ( isOnCeiling(doc) ) return hangsAt(doc, pos) && canWalkCeilingsAt(doc, pos);
  return holdsWallAt(doc, pos);
}

/** Cells to climb toward a target from: within `reach` cells of it (on the map), against a wall, on the same side of the wall. */
function climbSpotsToward(token, target, reach) {
  const scene = token.parent;
  const grid = scene.grid;
  const { sceneX, sceneY, sceneWidth, sceneHeight } = scene.dimensions;
  const top = grid.getOffset({ x: sceneX + 1, y: sceneY + 1 });
  const bottom = grid.getOffset({ x: sceneX + sceneWidth - 1, y: sceneY + sceneHeight - 1 });
  const bounds = { i0: top.i, j0: top.j, i1: bottom.i, j1: bottom.j };
  const elevation = token._source.elevation ?? 0;
  const level = token._source.level;
  const goal = tokenCenter(target);
  const spots = [];
  for ( let gap = 0; gap < reach; gap++ ) {
    for ( const cell of cellsAtGap(footprintOf(target), sizeOf(token), gap, bounds) ) {
      const pos = { ...grid.getTopLeftPoint(cell), elevation, level };
      if ( !wallsNear(token, pos).length ) continue;
      if ( rayBlocker(token, target, { posA: pos })(tokenCenter(token, pos), goal) ) continue;   // behind the wall: other side
      spots.push(cell);
    }
  }
  return spots;
}

/**
 * §196: reach a target out of reach across a vertical void (on the wall, on the ceiling near a wall) by climbing — the simple
 * case: go to the foot of the wall next to it (`api.approach`, within the turn budget), then climb the fewest cells that put it at
 * `reachCells` (the menu's climb, paid from the budget: ×2 without climbing speed; DC 15 check in "house" mode). Does not
 * decide who must climb: the caller (an AI) chooses. Returns `{ arrived, climbed, reason? }` — `reason`: `notOwner`, `noWall`
 * (no wall next to it, on its side), `cannotClimb`, `tooHigh` (even at the highest, still out of reach), `refused` (climb refused
 * or check failed), or what the walk returns (`noPath`, `exhausted`, `stopped`…).
 * @param {Token|TokenDocument} token
 * @param {Token|TokenDocument} target
 * @param {{reachCells?: number}} [options]
 */
export async function climbToward(token, target, { reachCells=1 }={}) {
  token = docOf(token);
  target = docOf(target);
  if ( !token?.isOwner || !target ) return { arrived: false, climbed: 0, reason: "notOwner" };
  if ( !climbSystemOn() ) return { arrived: false, climbed: 0, reason: "disabled" };   // §224
  const reach = Math.max(1, Math.round(reachCells) || 1);
  const there = () => ((token._source.level ?? null) === (target._source.level ?? null)) && (gapCells(token, target) <= reach);
  if ( there() ) return { arrived: true, climbed: 0 };
  if ( isOnCeiling(token) ) return { arrived: false, climbed: 0, reason: "cannotClimb" };
  const spots = climbSpotsToward(token, target, reach);
  if ( !spots.length ) return { arrived: false, climbed: 0, reason: "noWall" };
  const here = cellOf(token);
  if ( !spots.some(c => (c.i === here.i) && (c.j === here.j)) ) {
    const walked = await approach(token, { cells: spots });
    if ( !walked.arrived ) return { climbed: 0, ...walked };
    if ( there() ) return { arrived: true, climbed: 0 };
  }
  if ( !canClimb(token) ) return { arrived: false, climbed: 0, reason: "cannotClimb" };
  const grid = token.parent.grid;
  const room = climbRoom(token);
  const from = token._source.elevation ?? 0;
  const highest = Number.isFinite(room.ceiling) ? Math.floor(((room.ceiling - from) / grid.distance) + 1e-6) : 20;
  let need = null;
  for ( let n = 1; n <= Math.min(highest, 20); n++ ) {
    if ( gapCells(token, target, { posA: { elevation: from + (n * grid.distance) } }) <= reach ) { need = n; break; }
  }
  if ( need === null ) return { arrived: false, climbed: 0, reason: "tooHigh" };
  const n = Math.min(need, room.max);
  if ( n < 1 ) return { arrived: false, climbed: 0, reason: "exhausted" };
  if ( !(await startClimb(token, { cells: n })) ) return { arrived: false, climbed: 0, reason: "refused" };
  const climbed = Math.round(((token._source.elevation ?? 0) - from) / grid.distance);
  return there() ? { arrived: true, climbed } : { arrived: false, climbed, reason: "exhausted" };
}

/**
 * §196: `api.climb` — climbing for neighbours (interface, AI, gamepad). Reading: `state(token)`, `holds(token, cell)`,
 * `entries(token)` (the engine's menu entries: `{ icon, label, run }`); gestures, on the client that owns the token, without
 * `cells` the engine's "how many cells" window opens: `up(token, { cells })`, `run(token, { cells })` (Acrobatic Movement),
 * `ceiling(token)`, `down(token, { cells })`, `drop(token)` → boolean; `toward(token, target, { reachCells })` (see `climbToward`).
 * §224: `enabled()` / `setEnabled(on)` — the GM's switch; off, `entries` is empty, the gestures return false, `toward` "disabled".
 */
export const climbApi = Object.freeze({
  state: climbStateOf,
  holds: climbHoldsAt,
  /** The token menu's climbing entries (`{ icon, label, run }`: Climb the wall, the ceiling, Climb down, Let go…). */
  entries: token => climbEntries(docOf(token)).map(({ icon, label, run }) => ({ icon, label, run })),
  /** Climb the wall by `cells` cells (without `cells`: the "how many cells" window); client that owns the token → boolean. */
  up: (token, { cells=null }={}) => startClimb(docOf(token), { cells }),
  /** §195: "Run up the wall" (the monk's Acrobatic Movement), without a check; like `up` → boolean. */
  run: (token, { cells=null }={}) => startClimb(docOf(token), { cells, acrobatic: true }),
  /** Climb up to the ceiling ("house" rules check if due); client that owns the token → boolean. */
  ceiling: token => climbToCeiling(docOf(token)),
  /** Climb down along the wall (or ceiling) by `cells` cells (without `cells`: the window); client that owns the token → boolean. */
  down: (token, { cells=null }={}) => climbDown(docOf(token), { cells }),
  /** Let go of the wall or ceiling (voluntary fall); false if the token is not climbing or not on this client. */
  drop: token => dropDown(docOf(token)),
  /** §216: the edges from which the token can hang to descend along the wall: `[{ dir, x, y, elevation, level, drop }]`. */
  edges: token => edgesBelowOf(docOf(token)),
  /** §216: "Grab the edge" `edge` (an element of `edges`); client that owns the token → boolean. */
  grab: (token, edge) => grabEdge(docOf(token), edge),
  toward: climbToward,
  enabled: climbSystemOn,   // §224: is the climbing and falling system on? Hook `dnd5e-combat.climbSystem` (`enabled`)
  setEnabled: setClimbSystem   // §224: GM only → boolean (false for a player)
});

export function registerClimb() {
  game.settings.register(MODULE_ID, CLIMB_RULES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: { 2024: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.2024`, house: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.house` },
    default: "2024"
  });
  CONFIG.queries[CLIMB_QUERY] = handleClimbQuery;
  const executor = { executor: true };
  route("preMoveToken", onPreMoveToken, { cancellable: true, label: "ceiling: staying under it" });
  route("updateToken", onTokenUpdated, { ...executor, label: "climbing: status, flip or landing not applied" });
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, effect => checkClimbers(actorOfEffect(effect)), { ...executor, label: "climbing: fall not triggered" });
  }
  route("combatTurnChange", onTurnChange, { ...executor, label: "climbing: check not asked" });
  route("createChatMessage", onFallCard, { ...executor, label: "fall damage not applied" });
  route("ready", () => { setInterval(tick, TICK_MS); }, { label: "climbing: out-of-combat checks" });
}
