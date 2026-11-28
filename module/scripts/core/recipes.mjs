/**
 * The recipes (SPEC §114): the building blocks of the content schema (core/content.mjs) put the way a GM thinks of them — "bonus
 * damage", "a condition on failure", "an area that lasts" — with simple fields, and the way to derive a schema entry from them.
 * This is what a no-code tool (a content creator, a settings window) reads to build its forms: it knows neither the moments, nor
 * the steps, nor their cross constraints, the recipe sets them.
 *
 *   recipes = [{ type: "bonusDamage", values: { formula: "1d6", damageType: "necrotic", scope: "own" } }, …]
 *   buildEntry(recipes, { identifier: "mon-sort" })  →  { entry: { triggers: [...] }, errors: [] }
 *
 * The resulting entry is then validated like any content (`validateEntry`): a recipe bypasses nothing.
 *
 * Fields are typed by `kind`. Those that depend on Foundry or dnd5e (damage types, conditions, item activities)
 * carry only their kind; the tool that displays them derives the choices (CONFIG, the current item). Labels:
 * `DND5ECOMBAT.Recette.<type>.Nom` / `.Aide`, `DND5ECOMBAT.Recette.Champ.<champ>`, `DND5ECOMBAT.Recette.Valeur.<valeur>`,
 * `DND5ECOMBAT.Recette.Fait.<fait>` (lang/).
 *
 * Pure functions, no dependency on Foundry.
 */

/** Catalog version: goes up when a recipe changes fields or meaning (a saved creation carries it). */
export const RECIPES_VERSION = 1;

/** Les genres de champ. */
export const FIELD_KINDS = Object.freeze([
  "formula",      // dnd5e dice string ("1d6", "@prof")
  "number",       // nombre positif
  "boolean",
  "choice",       // une valeur parmi `options`
  "multi",        // one or more values among `options`
  "damageType",   // key of CONFIG.DND5E.damageTypes
  "status",       // id of a condition (CONFIG.statusEffects)
  "units",        // distance unit (ft, m)
  "activity",     // id of an item activity (`activityTypes`: optional filter)
  "effect",       // id d'un effet de l'item
  "condition"     // liste de clauses de faits, voir FACTS
]);

const UNITS = ["ft", "m"];

/**
 * The facts that can be set as a condition, and the shape of their argument (`arg`). A subset of the engine's facts
 * (adapter/facts.mjs), those that make sense to a GM; the test checks that they all exist. `subject` says whom it is about:
 * the author of the action (`source`), the targeted creature (`target`), the action itself (`activity`), the damage taken
 * (`damage`).
 *
 * Argument kinds: `true` (true fact, nothing to enter), `status`, `identifier` (item identifier), `creatureType`, `size`,
 * `range` ({ distance, units }), `damageTypes` (list), `number`, `activityType`, `classLevel` ({ class, level }).
 */
export const FACTS = Object.freeze({
  "activity.isAttack": { subject: "activity", arg: "true" },
  "activity.isMelee": { subject: "activity", arg: "true" },
  "activity.isSpell": { subject: "activity", arg: "true" },
  "activity.isWeapon": { subject: "activity", arg: "true" },
  "activity.type": { subject: "activity", arg: "activityType" },
  "activity.dealsType": { subject: "activity", arg: "damageTypes" },
  "source.hasStatus": { subject: "source", arg: "status" },
  "source.hasEffect": { subject: "source", arg: "identifier" },
  "source.creatureType": { subject: "source", arg: "creatureType" },
  "source.seesTarget": { subject: "source", arg: "true" },
  "source.allyNearTarget": { subject: "source", arg: "range" },
  "source.onOwnTurn": { subject: "source", arg: "true" },
  "source.classLevelAtLeast": { subject: "source", arg: "classLevel" },
  "target.hasStatus": { subject: "target", arg: "status" },
  "target.hasEffect": { subject: "target", arg: "identifier" },
  "target.hasEffectFrom": { subject: "target", arg: "identifier" },
  "target.creatureType": { subject: "target", arg: "creatureType" },
  "target.sizeAtMost": { subject: "target", arg: "size" },
  "target.within": { subject: "target", arg: "range" },
  "target.seesSource": { subject: "target", arg: "true" },
  "target.wounded": { subject: "target", arg: "true" },
  "target.bloodied": { subject: "target", arg: "true" },
  "target.hasTempHp": { subject: "target", arg: "true" },
  "target.hpAtMost": { subject: "target", arg: "number" },
  "damage.hasType": { subject: "damage", arg: "damageTypes" }
});

const ACTIVITY_TYPES = ["attack", "save", "damage", "heal", "utility", "cast", "summon", "enchant", "teleport", "check"];
const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
const CREATURE_TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"];

/** The allowed values of a fact argument, when they do not come from CONFIG (for the tool that displays them). */
export const FACT_ARG_OPTIONS = Object.freeze({ activityType: ACTIVITY_TYPES, size: SIZES, creatureType: CREATURE_TYPES, units: UNITS });

const isObject = v => (typeof v === "object") && (v !== null) && !Array.isArray(v);
const filled = v => (v !== undefined) && (v !== null) && (v !== "");

/** The problem codes (`issue`): each has its label `DND5ECOMBAT.Recette.Erreur.<code>` (test). */
export const ISSUE_CODES = Object.freeze(["required", "unknownRecipe", "unique", "needsIdentifier", "atLeastOneLimit", "unknownFact",
  "expectNumber", "expectRange", "expectClassLevel", "expectDamageType", "expectValue"]);

/**
 * A problem found while building an entry: `code` and `data` so that a tool can translate it
 * (`DND5ECOMBAT.Recette.Erreur.<code>`), `message` in English for the console and the tests.
 */
function issue(at, code, data, text) {
  return { at, code, data, message: `${at}: ${text}` };
}

/** A clause's argument, formatted for the fact (and its errors). */
function factArg(fact, arg, at, errors) {
  const shape = FACTS[fact];
  switch ( shape.arg ) {
    case "true": return true;
    case "number": {
      const n = Number(arg);
      if ( !Number.isFinite(n) ) errors.push(issue(at, "expectNumber", {}, "a number is expected"));
      return n;
    }
    case "range": {
      const distance = Number(arg?.distance);
      if ( !(Number.isFinite(distance) && (distance > 0)) || !UNITS.includes(arg?.units) ) errors.push(issue(at, "expectRange", {}, "{ distance, units } expected"));
      return { distance, units: arg?.units };
    }
    case "classLevel": {
      const level = Number(arg?.level);
      if ( !filled(arg?.class) || !(Number.isInteger(level) && (level > 0)) ) errors.push(issue(at, "expectClassLevel", {}, "{ class, level } expected"));
      return { class: arg?.class, level };
    }
    case "damageTypes": {
      const list = [arg].flat().filter(filled);
      if ( !list.length ) errors.push(issue(at, "expectDamageType", {}, "at least one damage type"));
      return list;
    }
    default: {
      const options = FACT_ARG_OPTIONS[shape.arg];
      if ( !filled(arg) || (options && ![arg].flat().every(a => options.includes(a))) ) errors.push(issue(at, "expectValue", {}, `a value is expected${options ? ` (${options.join(", ")})` : ""}`));
      return arg;
    }
  }
}

/**
 * An engine condition (core/triggers.mjs, `holds`) built from `{ fact, arg?, not? }` clauses, all required.
 * No clauses: `null` (no condition). Problems go into `errors` (see `issue`).
 */
export function buildCondition(clauses=[], { at="condition", errors=[] }={}) {
  const parts = [];
  (Array.isArray(clauses) ? clauses : []).forEach((c, i) => {
    if ( !isObject(c) || !(c.fact in FACTS) ) return errors.push(issue(`${at}[${i}]`, "unknownFact", { fact: String(c?.fact) }, `unknown fact "${c?.fact}"`));
    const part = { [c.fact]: factArg(c.fact, c.arg, `${at}[${i}]`, errors) };
    parts.push(c.not ? { not: part } : part);
  });
  if ( !parts.length ) return null;
  return parts.length === 1 ? parts[0] : { all: parts };
}

/** Two conditions (or `null`) in one. */
function both(a, b) {
  if ( !a ) return b ?? null;
  if ( !b ) return a;
  return { all: [a, b] };
}

/** "Only this item's activities": the fact that says so, from the creation's identifier. */
function ownScope(scope, ctx, errors) {
  if ( scope !== "own" ) return null;
  if ( !filled(ctx?.identifier) ) errors.push(issue("scope", "needsIdentifier", {}, "\"this item only\" needs the item's identifier"));
  return { "activity.identifier": ctx?.identifier };
}

/** A trigger declaration, without empty keys. */
function declaration({ on, via=null, condition=null, ...rest }, steps) {
  const d = { on };
  if ( via ) d.via = via;
  if ( condition ) d.if = condition;
  Object.assign(d, rest);
  d.do = steps;
  return d;
}

/**
 * The catalog. Each recipe: `category` (for sorting), `fields` (`{ key, kind, required?, default?, options?,
 * activityTypes?, when? }` — `when`: `{ champ: valeur | [valeurs] }`, the field only makes sense if…), `keys` (the entry
 * keys it produces), `unique` (only one per item), `build(values, ctx, errors)` → entry fragment, and `example`
 * (values that must produce a valid entry: the test checks it).
 */
export const RECIPES = Object.freeze({
  // B2 — Hex, Spirit Shroud, Death Ward.
  bonusDamage: {
    category: "damage",
    keys: ["triggers"],
    fields: [
      { key: "formula", kind: "formula", required: true },
      { key: "damageType", kind: "damageType", required: true },
      { key: "scope", kind: "choice", options: ["own", "all"], default: "own" },
      { key: "oncePerTurn", kind: "boolean", default: false },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      const condition = both(ownScope(v.scope ?? "own", ctx, errors), buildCondition(v.condition, { errors }));
      const extra = v.oncePerTurn ? { oncePerTurn: true } : {};
      return { triggers: [declaration({ on: "preDamageRoll", condition, ...extra }, [{ type: "damage", formula: v.formula, damageType: v.damageType }])] };
    },
    example: { formula: "1d6", damageType: "necrotic", scope: "all", condition: [{ fact: "activity.isAttack" }, { fact: "target.hasEffectFrom", arg: "hex" }] }
  },

  // B6 — Faerie Fire (carried by an effect), Pack Tactics (carried by the item).
  attackModifier: {
    category: "attack",
    keys: ["triggers"],
    fields: [
      { key: "mode", kind: "choice", options: ["advantage", "disadvantage"], required: true },
      { key: "carrier", kind: "choice", options: ["item", "effect"], default: "item" },
      { key: "scope", kind: "choice", options: ["own", "all"], default: "all", when: { carrier: "item" } },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      const viaEffect = v.carrier === "effect";
      const condition = both(viaEffect ? null : ownScope(v.scope ?? "all", ctx, errors), buildCondition(v.condition, { errors }));
      return { triggers: [declaration({ on: "preAttackRoll", via: viaEffect ? "effect" : null, condition }, [{ type: v.mode }])] };
    },
    example: { mode: "advantage", carrier: "effect", condition: [{ fact: "target.hasEffect", arg: "faerie-fire" }, { fact: "source.seesTarget" }] }
  },

  // B7 — Eldritch Strike (Prone), monsters' "Grappled on touch".
  outcomeStatus: {
    category: "outcome",
    keys: ["triggers"],
    fields: [
      { key: "on", kind: "choice", options: ["hit", "failedSave"], required: true },
      { key: "status", kind: "status", required: true },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      return { triggers: [declaration({ on: v.on, condition: buildCondition(v.condition, { errors }) }, [{ type: "status", status: v.status }])] };
    },
    example: { on: "failedSave", status: "prone" }
  },

  // B3 — Thunderwave (push), Thorn Whip (pull).
  forcedMove: {
    category: "outcome",
    keys: ["triggers"],
    fields: [
      { key: "on", kind: "choice", options: ["hit", "failedSave"], required: true },
      { key: "mode", kind: "choice", options: ["push", "pull"], default: "push" },
      { key: "distance", kind: "number", required: true },
      { key: "units", kind: "units", default: "ft" },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      const step = { type: "move", mode: v.mode ?? "push", distance: Number(v.distance), units: v.units ?? "ft" };
      return { triggers: [declaration({ on: v.on, condition: buildCondition(v.condition, { errors }) }, [step])] };
    },
    example: { on: "failedSave", mode: "push", distance: 10, units: "ft", condition: [{ fact: "target.sizeAtMost", arg: "lg" }] }
  },

  // B4 — Hold Person: the effect placed by the item repeats the saving throw.
  repeatSave: {
    category: "effect",
    keys: ["triggers"],
    fields: [
      { key: "moments", kind: "multi", options: ["endOfTurn", "startOfTurn", "isDamaged"], default: ["endOfTurn"], required: true }
    ],
    build(v) {
      return { triggers: [declaration({ on: [v.moments ?? ["endOfTurn"]].flat(), via: "effect" }, [{ type: "resave" }])] };
    },
    example: { moments: ["endOfTurn"] }
  },

  // B8 — Sleep, Hypnotic Pattern: the effect ends when its bearer takes damage.
  endsOnDamage: {
    category: "effect",
    keys: ["triggers"],
    fields: [],
    build() {
      return { triggers: [declaration({ on: "isDamaged", via: "effect" }, [{ type: "remove" }])] };
    },
    example: {}
  },

  // B1 — Rayon de lune, Esprits gardiens, Nuage de dagues.
  lastingZone: {
    category: "zone",
    keys: ["triggers"],
    fields: [
      { key: "moments", kind: "multi", options: ["enter", "turnStart", "turnEnd", "moves"], default: ["enter", "turnEnd"], required: true },
      { key: "activity", kind: "activity" }
    ],
    build(v) {
      const step = { type: "replay" };
      if ( filled(v.activity) ) step.activity = v.activity;
      return { triggers: [declaration({ on: [v.moments ?? ["enter", "turnEnd"]].flat() }, [step])] };
    },
    example: { moments: ["enter", "turnEnd"] }
  },

  // B5 — Shield (hit), Hellish Rebuke (wounded, toward the attacker), Absorb Elements.
  reaction: {
    category: "reaction",
    keys: ["triggers"],
    fields: [
      { key: "on", kind: "choice", options: ["isHit", "isDamaged", "isMissed"], required: true },
      { key: "activity", kind: "activity" },
      { key: "target", kind: "choice", options: ["self", "source"], default: "self" },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      const step = { type: "use" };
      if ( filled(v.activity) ) step.activity = v.activity;
      if ( v.target === "source" ) step.target = "source";
      return { triggers: [declaration({ on: v.on, condition: buildCondition(v.condition, { errors }) }, [step])] };
    },
    example: { on: "isDamaged", target: "source", condition: [{ fact: "target.seesSource" }] }
  },

  // B9 — Fire Shield, Corrosive Form: whoever hits the bearer takes damage.
  retaliation: {
    category: "defense",
    keys: ["triggers"],
    fields: [
      { key: "formula", kind: "formula", required: true },
      { key: "damageType", kind: "damageType", required: true },
      { key: "carrier", kind: "choice", options: ["item", "effect"], default: "item" },
      { key: "meleeOnly", kind: "boolean", default: true },
      { key: "condition", kind: "condition" }
    ],
    build(v, ctx, errors) {
      const melee = (v.meleeOnly ?? true) ? { "activity.isMelee": true } : null;
      const condition = both(melee, buildCondition(v.condition, { errors }));
      const via = v.carrier === "effect" ? "effect" : null;
      return { triggers: [declaration({ on: "isHit", via, condition }, [{ type: "damage", to: "source", formula: v.formula, damageType: v.damageType }])] };
    },
    example: { formula: "1d8", damageType: "acid", meleeOnly: true }
  },

  // B13 — Aura de protection, Passage sans trace.
  aura: {
    category: "zone",
    keys: ["aura"],
    unique: true,
    fields: [
      { key: "radius", kind: "number", required: true },
      { key: "units", kind: "units", default: "ft" },
      { key: "affects", kind: "choice", options: ["ally", "enemy", "any"], default: "ally" },
      { key: "includeSelf", kind: "boolean", default: false },
      { key: "effect", kind: "effect" },
      { key: "whileActive", kind: "boolean", default: false }
    ],
    build(v) {
      const aura = { radius: Number(v.radius), units: v.units ?? "ft", affects: v.affects ?? "ally", includeSelf: !!v.includeSelf };
      if ( filled(v.effect) ) aura.effect = v.effect;
      if ( v.whileActive ) aura.whileActive = true;
      return { aura };
    },
    example: { radius: 10, units: "ft", affects: "ally", includeSelf: true }
  },

  // B16 — Poisoned Bite: the attack that hits imposes the saving throw of another activity of the item.
  hitThenSave: {
    category: "outcome",
    keys: ["onHit"],
    unique: true,
    fields: [{ key: "save", kind: "activity", activityTypes: ["save"], required: true }],
    build(v) {
      return { onHit: { save: v.save } };
    },
    example: { save: "udF9lrpAQMvL0b9J" }
  },

  // B11 — Misty Step, Dimension Door.
  teleport: {
    category: "movement",
    keys: ["teleport"],
    unique: true,
    fields: [
      { key: "distance", kind: "number", required: true },
      { key: "units", kind: "units", default: "ft" },
      { key: "activity", kind: "activity" }
    ],
    build(v) {
      const teleport = { distance: Number(v.distance), units: v.units ?? "ft" };
      if ( filled(v.activity) ) teleport.activity = v.activity;
      return { teleport };
    },
    example: { distance: 30, units: "ft" }
  },

  // B12 — PHB summonings: the creature acts after its summoner, and vanishes with Concentration.
  summon: {
    category: "summon",
    keys: ["summon"],
    unique: true,
    fields: [
      { key: "initiative", kind: "choice", options: ["after", "own", "none"], default: "after" },
      { key: "endsAtZero", kind: "boolean", default: false }
    ],
    build(v) {
      const summon = { initiative: v.initiative ?? "after" };
      if ( v.endsAtZero ) summon.endsAtZero = true;
      return { summon };
    },
    example: { initiative: "after" }
  },

  // §16.40 — "Once on each of your turns", changed action cost.
  usageLimit: {
    category: "usage",
    keys: ["usageLimits"],
    fields: [
      { key: "activity", kind: "activity", required: true },
      { key: "oncePerTurn", kind: "boolean", default: true },
      { key: "cost", kind: "choice", options: ["", "action", "bonus", "reaction"], default: "" }
    ],
    build(v, ctx, errors) {
      const rule = {};
      if ( v.oncePerTurn ?? true ) rule.oncePerTurn = true;
      if ( filled(v.cost) ) rule.cost = v.cost;
      if ( !Object.keys(rule).length ) errors.push(issue("usageLimit", "atLeastOneLimit", {}, "at least one limit"));
      return { usageLimits: { [v.activity]: rule } };
    },
    example: { activity: "7nAgPNN2dth7SR0D", oncePerTurn: true }
  },

  // Item effects that end on a rest (Mage Armor: Long Rest).
  effectsExpire: {
    category: "effect",
    keys: ["effectsExpire"],
    unique: true,
    fields: [{ key: "rest", kind: "choice", options: ["longRest", "shortRest"], default: "longRest" }],
    build(v) {
      return { effectsExpire: v.rest ?? "longRest" };
    },
    example: { rest: "longRest" }
  }
});

/** The entry keys that a no-code tool can produce (the others stay with hand-written content). */
export const PUBLIC_KEYS = Object.freeze(Array.from(new Set(Object.values(RECIPES).flatMap(r => r.keys))));

/** A recipe's empty required fields. */
function missing(recipe, values, errors) {
  for ( const f of recipe.fields ) {
    if ( !f.required ) continue;
    if ( f.when && !Object.entries(f.when).every(([k, want]) => [want].flat().includes(values[k] ?? recipe.fields.find(x => x.key === k)?.default)) ) continue;
    const v = values[f.key] ?? f.default;
    if ( !filled(v) || (Array.isArray(v) && !v.length) ) errors.push(issue(f.key, "required", { field: f.key }, "required"));
  }
}

/**
 * The schema entry drawn from a list of recipes. Triggers are appended, `usageLimits` is merged per activity, a
 * `unique` key comes only once. `base`: an existing entry to build on (resuming an item), kept as is
 * — its triggers come before those of the recipes.
 *
 * Problems are rendered twice: `errors`, sentences in English (console, tests); `issues`, what is needed to translate them —
 * `{ recipe, type, at, code, data }`, `recipe` the recipe's index, `at` the field (or clause) at fault, `code` a key
 * of `DND5ECOMBAT.Recette.Erreur`.
 * @param {{type: string, values?: object}[]} recipes
 * @param {{identifier?: string, base?: object|null}} ctx
 * @returns {{entry: object, errors: string[], issues: object[]}}
 */
export function buildEntry(recipes=[], ctx={}) {
  const issues = [];
  const entry = isObject(ctx.base) ? structuredClone(ctx.base) : {};
  const seen = new Set();
  (Array.isArray(recipes) ? recipes : []).forEach((r, i) => {
    const local = [];
    const record = () => issues.push(...local.map(e => ({ recipe: i, type: r?.type ?? null, at: e.at, code: e.code, data: e.data,
      message: `recipes[${i}].${e.message}` })));
    const recipe = RECIPES[r?.type];
    if ( !recipe ) { local.push(issue("type", "unknownRecipe", { type: String(r?.type) }, `unknown recipe "${r?.type}"`)); return record(); }
    if ( recipe.unique && seen.has(r.type) ) { local.push(issue("type", "unique", { type: r.type }, `"${r.type}" only once per item`)); return record(); }
    seen.add(r.type);
    const values = isObject(r.values) ? r.values : {};
    missing(recipe, values, local);
    if ( local.length ) return record();
    const fragment = recipe.build(values, ctx, local);
    record();
    for ( const [key, value] of Object.entries(fragment) ) {
      if ( key === "triggers" ) entry.triggers = [entry.triggers ?? []].flat().concat(value);
      else if ( key === "usageLimits" ) entry.usageLimits = { ...(entry.usageLimits ?? {}), ...value };
      else entry[key] = value;
    }
  });
  return { entry, errors: issues.map(e => e.message), issues };
}
