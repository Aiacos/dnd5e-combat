/**
 * Circulation guards (§406): how information must flow in the engine, enforced by reading the code — as
 * tests/layers.test.mjs enforces the layers. Each rule states the defect it prevents; each exception is listed, with its reason.
 * An exception that no longer matches any call makes the test fail: the list stays accurate.
 * Reference: prive/ARCHITECTURE.md, "Règles de circulation".
 */
import { describe, it, expect } from "vitest";
import { allFiles, callsIn, code, lineAt, enclosing } from "./source-scan.mjs";

const FILES = allFiles();
const key = site => `${site.file}#${site.fn}`;

/** Checks a list of sites against an allowlist `{ "fichier#fonction": raison }`: returns the offenders and the dead exceptions. */
function check(sites, allowed) {
  const bad = sites.filter(s => !s.ok && !(key(s) in allowed)).map(s => `${s.file}:${s.line} (${s.fn}) — ${s.what}`);
  const used = new Set(sites.filter(s => !s.ok).map(key));
  const stale = Object.keys(allowed).filter(k => !used.has(k));
  return { bad, stale };
}

/* -------------------------------------------- */
/*  1. The dice of an activity at the casting level (§404)
/* -------------------------------------------- */

/**
 * An activity reread by its uuid (`fromUuid(message.system.activity.uuid)`), taken from the sheet (`item.system.activities.get`) or
 * by `getAssociatedActivity()` without `{ scaled: true }` is the sheet's, **at base level**: its "Using a Higher-Level
 * Spell Slot" dice are missing (§404: Chromatic Orb cast at level 3 → 3d8 instead of 5d8, present from 0.166.0 to 0.281.1). Any
 * function that rolls the dice of an activity (`rollDamage`, `getDamageConfig`, an activity formula in `new Roll`) therefore goes
 * through the casting level: `atCastLevel` (core/usage.mjs), `item.scaledClone(n)`, `getAssociatedActivity({ scaled: true })` or
 * `followUpScaling` — or is listed below with its reason.
 */
const CAST_LEVEL = /atCastLevel\(|scaledClone\(|scaled:\s*true|followUpScaling\(/;

const CAST_LEVEL_EXCEPTIONS = {
  "adapter/defenses.mjs#spendHitDiceToHeal": "dés de vie dépensés (Résilience…) : le nombre est choisi, rien ne monte avec un emplacement",
  "adapter/potions.mjs#healingFormulaOf": "potion de soins (issue #31) : un consommable, jamais lancé avec un emplacement ; ne lance rien, lit la formule et son maximum",
  "adapter/inspiration.mjs#offerRollBonus": "dé ajouté à un jet (Inspiration, Chanceux, Se ressaisir) : formule de la règle, pas de montée",
  "adapter/regeneration.mjs#regenerate": "Régénération d'un monstre : une aptitude, jamais lancée avec un emplacement",
  "adapter/usage.mjs#hasDamageParts": "ne lance rien : regarde seulement si l'activité a des dés de dégâts",
  "runtime/correction.mjs#rollDamage": "reçoit l'activité déjà au niveau choisi (applyCorrection : `item.scaledClone(scaling)`)",
  "runtime/cure.mjs#sharePool": "repli quand le jet de dnd5e manque : le chemin normal lit le message `healing` de dnd5e, déjà au niveau "
    + "lancé ; réserves d'aptitudes (Survivance, Châtiment exaltant…) et Guérison de groupe (niveau 9, ne monte pas)",
  "runtime/felled.mjs#onResolution": "soin d'une aptitude déclenché par une créature qui tombe (`fellRule`) : aucun sort, aucune montée",
  "runtime/maneuver-dice.mjs#onPostUse": "dé de supériorité (Maître de guerre) : la taille suit le niveau de classe, pas un emplacement",
  "runtime/maneuver-dice.mjs#chosenAc": "dé de supériorité (Parade) : même raison"
};

/** The sites that roll the dice of an activity. */
function diceSites() {
  const sites = [];
  for ( const file of FILES ) {
    for ( const c of callsIn(file, /rollDamage|getDamageConfig/) ) {
      sites.push({ file, line: c.line, fn: c.fn.name, ok: CAST_LEVEL.test(c.fn.body), what: `.${c.method}( sans niveau de lancement` });
    }
    const text = code(file);
    for ( const m of text.matchAll(/new\s+(?:Roll|CONFIG\.Dice\.DamageRoll)\(([^\n]*)/g) ) {
      // A formula taken from an activity: its healing formula, its roll formula (`roll.formula`), or the activity's roll data.
      if ( !/activit|\.healing\b|\.roll\.formula/.test(m[1]) ) continue;
      const fn = enclosing(text, m.index);
      sites.push({ file, line: lineAt(text, m.index), fn: fn.name, ok: CAST_LEVEL.test(fn.body), what: "formule d'activité sans niveau de lancement" });
    }
  }
  return sites;
}

describe("circulation 1 — the dice of an activity at the casting level (§404)", () => {
  it("any function that rolls the dice of an activity goes through the casting level, or is a justified exception", () => {
    const { bad, stale } = check(diceSites(), CAST_LEVEL_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale, "exceptions qui ne servent plus : à retirer").toEqual([]);
  });

  it("the guard sees the §404 defect (a reread by uuid without atCastLevel)", () => {
    const fn = "async function f(m) { const a = await fromUuid(m.system.activity.uuid); return a.rollDamage({}, {}, { data: { system: { origin: m.id } } }); }";
    expect(CAST_LEVEL.test(fn)).toBe(false);
    expect(CAST_LEVEL.test(fn.replace("a.rollDamage", "atCastLevel(a, 2).rollDamage"))).toBe(true);
  });
});

/**
 * 1 bis (§406): the same rule for an activity that the engine **reuses** later from a usage message (an area that
 * falls, a pulse at the caster's turn, a prepared spell): `activity.use()` recomputes the scaling from the proposed slot, at the
 * spell's level (§405) — without `scaling` or a slot in the configuration, the activity goes out at base level. Found when the
 * guard was created: the explosion of Delayed Blast Fireball (`zoneEnd`, runtime/areas.mjs). The guard looks at `.use(` calls of
 * functions that reread a usage message; the configuration passes `scaling`, a `slot` or `castLevelUsage` (core/usage.mjs).
 */
const REUSE_EXCEPTIONS = {
  "runtime/after-sneak.mjs#onResolution": "aptitude après une Attaque sournoise (`afterSneak`) : pas un sort, rien ne monte",
  "runtime/correction.mjs#correctZone": "la configuration `usage` est bâtie plus haut avec l'emplacement du niveau choisi par le MJ (`slotKey`)"
};

describe("circulation 1 bis — an activity reused from a usage message keeps its level (§406)", () => {
  it("any .use( of a function that rereads a usage message passes the scaling, or is a justified exception", () => {
    const sites = FILES.filter(f => !/testing/.test(f)).flatMap(file => callsIn(file, /use/)
      .filter(c => /game\.messages\.get\(|usageMessage|getAssociatedActivity\(|\.usage/.test(c.fn.body))
      .map(c => ({ file, line: c.line, fn: c.fn.name, ok: /scaling|castLevelUsage\(|followUpScaling\(|slot/.test(c.args),
        what: ".use( sans niveau de lancement" })));
    const { bad, stale } = check(sites, REUSE_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale).toEqual([]);
  });
});

/* -------------------------------------------- */
/*  2. A roll attached to its originating card
/* -------------------------------------------- */

/**
 * An attack or damage roll made by the engine carries the usage card that produced it (`data.system.origin`, like the
 * button of dnd5e's card, activity/attack.mjs). Without it, the roll "carries" itself: the resolution waiting for this roll
 * does not recognize it (stuck in `awaitingAttack`), the casting level (`system.scaling` of the originating message, §404) and
 * the chosen damage type (§16) are lost.
 */
const ORIGIN_EXCEPTIONS = {
  "adapter/messages.mjs#rollDamageForAttack": "`system` bâti plus haut avec `origin: originOf(attackMessage)` (et les cibles, §373)",
  "runtime/ammo.mjs#onPreRollAttack": "relance le même jet après le choix de la munition, avec la configuration de message d'origine (`message`)"
};

describe("circulation 2 — rolls attached to their originating card", () => {
  it("any rollAttack / rollDamage of the engine passes `system.origin`, or is a justified exception", () => {
    const sites = FILES.flatMap(file => callsIn(file, /rollAttack|rollDamage/).map(c => ({
      file, line: c.line, fn: c.fn.name, ok: /\borigin\b/.test(c.args), what: `.${c.method}( sans system.origin`
    })));
    const { bad, stale } = check(sites, ORIGIN_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale, "exceptions qui ne servent plus : à retirer").toEqual([]);
  });
});

/* -------------------------------------------- */
/*  3. The validated position of a token, not its animated position
/* -------------------------------------------- */

/**
 * Foundry V14 trap (seen on 2026-09-20, adapter/turn.mjs `committedPosition`): `token.x` / `token.y` of a TokenDocument and
 * `token.object.center` follow the movement animation; read right after a `move`, they still give a starting cell (in a
 * hidden tab, always). Any engine measurement (adapter/, runtime/, core/) starts from `token._source`: `committedPosition`,
 * `getCenterPoint(token._source)`. The interface (ui/) may draw at the animated position. The guard reads the usual names of a
 * token (`token`, `tok`) and any read through `.document` or `.object`; it found two defects when created (§406: Darkness
 * dispelling spell lights, spell areas near a caster).
 */
const ANIMATED = /\b(?:token|tok)\??\.(?:x|y)\b|\.document\??\.(?:x|y)\b|\.object\??\.(?:x|y|center)\b|getCenterPoint\??\.?\(\s*\)/g;
const ANIMATED_EXCEPTIONS = {};

describe("circulation 3 — validated position (`_source`), not animated", () => {
  it("adapter/, runtime/, core/ do not read token.x, .document.x, .object.center or getCenterPoint() without `_source`", () => {
    const sites = [];
    for ( const file of FILES.filter(f => /^(adapter|runtime|core)\//.test(f) && !/testing/.test(f)) ) {
      const text = code(file);
      for ( const m of text.matchAll(ANIMATED) ) {
        sites.push({ file, line: lineAt(text, m.index), fn: enclosing(text, m.index).name, ok: false, what: m[0] });
      }
    }
    const { bad, stale } = check(sites, ANIMATED_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale).toEqual([]);
  });
});

/* -------------------------------------------- */
/*  4. Typed damage, not a bare number
/* -------------------------------------------- */

/**
 * `Actor5e#applyDamage(nombre)` sets `options.ignore = true`: Resistances, Immunities and Vulnerabilities are skipped (dnd5e 6.0.6,
 * dnd5e.mjs:43266-43269). The engine always passes a list `[{ value, type, properties }]` — a literal, or a list named
 * `damages` / `applied` built earlier (adapter/messages.mjs `applyDamageToToken`). A bare number is wanted only where the rule
 * requires it, listed below.
 */
const TYPED_DAMAGE_EXCEPTIONS = {
  "runtime/engine-commands.mjs#COMMANDS": "« elle tombe à 0 PV » (Regard mortel, K2 §323) : des dégâts égaux à ses PV, sans type ni résistance",
  "runtime/triggers.mjs#onDamaged": "Lien protecteur sans formule (§156) : le lanceur subit le même montant que le porteur, déjà après ses résistances, sans type"
};

describe("circulation 4 — applyDamage receives typed damage", () => {
  it("any applyDamage of the engine passes a [{ value, type }] list, or is a justified exception", () => {
    const sites = FILES.filter(f => !/testing/.test(f)).flatMap(file => callsIn(file, /applyDamage/).map(c => {
      const first = c.args.trim();
      const ok = first.startsWith("[") || /^(damages|applied)\b/.test(first);
      return { file, line: c.line, fn: c.fn.name, ok, what: `applyDamage(${first.replace(/\s+/g, " ").slice(0, 40)}…)` };
    }));
    const { bad, stale } = check(sites, TYPED_DAMAGE_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale).toEqual([]);
  });
});

/* -------------------------------------------- */
/*  5. Le niveau de lancement d'un message : `system.scaling`
/* -------------------------------------------- */

/**
 * dnd5e 6 records the spell slot scaling on the usage message in `system.scaling` (dnd5e.mjs:17956); `flags.dnd5e.scaling`
 * exists only on a cloned item (`scaledClone`) or an effect (Concentration, applied effect), and the migration removes it from
 * messages (dnd5e.mjs:94993). Read on a message, it is always nothing: three defects when the guard was created (§406 — Globe of
 * Invulnerability, Spell Shaper, copies given by a spell, all at base level). The guard refuses `getFlag("dnd5e", "scaling")` and
 * `flags.dnd5e.scaling` read on a message name (`message`, `msg`, `m`, `usage`, `carrier`, `usageMessage`, `origin`…).
 */
const MESSAGE_SCALING_FLAG = /\b(?:message|msg|m|usage|usageMessage|carrier|origin|originMessage|card|attackMessage)\??\.(?:getFlag\??\.?\(\s*"dnd5e"\s*,\s*"scaling"|flags\??\.dnd5e\??\.scaling)/g;

describe("circulation 5 — a message's scaling is read in system.scaling", () => {
  it("aucun message n'est lu par flags.dnd5e.scaling", () => {
    const bad = [];
    for ( const file of FILES ) {
      const text = code(file);
      for ( const m of text.matchAll(MESSAGE_SCALING_FLAG) ) bad.push(`${file}:${lineAt(text, m.index)} — ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  /**
   * A usage card made by the engine (replayed area, repeated saving throw, pulse, Emanation, riposte, correction) carries
   * the scaling: it copies the `system` of a real usage card, or passes `scaling` (`cardScaling`, adapter/areas.mjs).
   * Without it, `getAssociatedActivity({ scaled: true })` returns the activity at base level (found at creation: riposte by
   * saving throw and the five `getCardData` factories of adapter/areas.mjs).
   */
  it("any `type: \"usage\"` card created by the engine carries `scaling` or copies the `system` of a usage card", () => {
    const bad = [];
    for ( const file of FILES.filter(f => !/testing/.test(f)) ) {
      const text = code(file);
      for ( const m of text.matchAll(/type:\s*"usage"/g) ) {
        const fn = enclosing(text, m.index);
        if ( !/\bscaling\b|cardScaling\(|\.\.\.\s*\w*[Mm]essage\??\.system\b|\.\.\.\s*usage\??\.system\b/.test(fn.body) ) bad.push(`${file}:${lineAt(text, m.index)} (${fn.name})`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/* -------------------------------------------- */
/*  6. La carte d'origine par son id : `_source.system.origin`
/* -------------------------------------------- */

/**
 * `system.origin` of a dnd5e message is a `ForeignDocumentField` (dnd5e.mjs:86248): read on the document, it returns the
 * originating message itself (or null), not its id — `game.messages.get(message.system.origin)` never finds anything. The id is
 * read in `_source.system.origin` (adapter/messages.mjs `originOf`); in a message configuration
 * (`messageConfig.data.system.origin`),
 * it is indeed an id. Defect found at creation (§406): the casting level of an attack reread on the attack card instead of
 * the usage card (runtime/engine-messages.mjs).
 */
describe("circulation 6 — the id of the originating card is read in _source", () => {
  it("no game.messages.get(…system.origin) outside `_source` or a `data.system.origin` configuration", () => {
    const bad = [];
    for ( const file of FILES ) {
      const text = code(file);
      for ( const m of text.matchAll(/messages\.get\(([^)]*?)\bsystem\??\.origin\b/g) ) {
        if ( /_source\??\.$|data\??\.$/.test(m[1]) ) continue;
        bad.push(`${file}:${lineAt(text, m.index)} — ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/* -------------------------------------------- */
/*  7. An item recognized by identifierOf, not by its raw identifier
/* -------------------------------------------- */

/**
 * An item created without an identifier (premium, or in a French client) receives from dnd5e `formatIdentifier(nom)` — the
 * name **translated** by Babele (dnd5e.mjs:35923-35926): "pied-de-biche" instead of "crowbar". The engine recognizes an item by
 * `identifierOf` (adapter/content.mjs: source, English name kept by Babele…) and reads its content through `contentOf`. Comparing
 * `system.identifier` to a value is wanted only where raw data is read, listed below. Defect found at creation (§406): the Crowbar
 * (runtime/doors.mjs).
 */
const RAW_IDENTIFIER_EXCEPTIONS = {
  "adapter/apply-effects.mjs#lostEffectOf": "index d'un compendium (données sources, identifiant anglais du module)",
  "adapter/sneak.mjs#owns": "identifierOf d'abord ; l'identifiant brut en repli, pour un item que le moteur a lui-même créé",
  "adapter/turn.mjs#costFor": "l'item d'action de base que le moteur crée lui-même, d'identifiant fixe (`dnd5e-combat-search`)",
  "runtime/diagnostic/checks.mjs#officialFor": "diagnostic : compare les données brutes d'un monde à celles du compendium",
  "runtime/diagnostic/checks.mjs#cleanActor": "diagnostic : nettoyage Midi d'une fiche, sur les identifiants bruts de ses items",
  "runtime/diagnostic/checks.mjs#creatures": "diagnostic : répare justement l'identifiant brut"
};

describe("circulation 7 — an item is recognized by identifierOf", () => {
  it("no comparison of system.identifier outside the justified exceptions", () => {
    const sites = [];
    for ( const file of FILES.filter(f => /^(adapter|runtime|ui)\//.test(f) && !/testing/.test(f)) ) {
      const text = code(file);
      for ( const m of text.matchAll(/system\??\.identifier\s*(?:===|!==)|(?:===|!==)\s*[\w.?]*system\??\.identifier\b/g) ) {
        sites.push({ file, line: lineAt(text, m.index), fn: enclosing(text, m.index).name, ok: false, what: m[0] });
      }
    }
    const { bad, stale } = check(sites, RAW_IDENTIFIER_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale).toEqual([]);
  });
});

/* -------------------------------------------- */
/*  8. Walls tested on the creature's level
/* -------------------------------------------- */

/**
 * Without `level`, a ray cast of the core (`polygonBackends.*.testCollision`) tests the walls of the **displayed** level (V14,
 * client/canvas/geometry/shapes/source-polygon.mjs:187 `cfg.level ??= canvas.level`): the Cover, line of sight, hearing and A*
 * of a creature on another floor would be judged on the wrong plane (SPEC §14.2, §41.3). Every `testCollision` passes `level`.
 */
describe("circulation 8 — un lancer de rayon passe le niveau", () => {
  it("every testCollision passes `level` (in its arguments or in the configuration built by its function)", () => {
    const bad = FILES.filter(f => !/testing/.test(f)).flatMap(file => callsIn(file, /testCollision/)
      .filter(c => !/\blevel\b/.test(c.args) && !/\blevel\b/.test(c.fn.body.slice(0, c.fn.body.indexOf("testCollision"))))
      .map(c => `${file}:${c.line} (${c.fn.name})`));
    expect(bad).toEqual([]);
  });
});

/* -------------------------------------------- */
/*  9. Friend or foe by factions
/* -------------------------------------------- */

/**
 * Since §181, every friend / foe rule goes through the factions (`areEnemies`, `areAllies`, `sideOf`, adapter/factions.mjs;
 * `hostileSides` / `alliedSides`, core/factions.mjs), which fall back exactly on the dispositions when no relation is
 * declared. Comparing `disposition` elsewhere would ignore a declared faction (a neutral NPC allied with the group).
 */
const DISPOSITION_EXCEPTIONS = {
  "core/area.mjs#pulseTargets": "teste seulement qu'un lanceur a une disposition ; le camp est jugé par `alliedSides`",
  "adapter/help.mjs#helperAllied": "repli quand le token qui aide a disparu (plus de camp à lire)",
  "adapter/summons.mjs#makeSummonHostile": "écriture : une invocation qui se retourne contre son lanceur",
  "runtime/factions.mjs#syncDispositions": "écriture : le module des factions aligne les dispositions",
  "runtime/factions.mjs#onPreCreateToken": "écriture : le module des factions aligne les dispositions",
  "runtime/factions.mjs#onResolution": "écriture : rancune (une créature attaquée devient hostile)"
};

describe("circulation 9 — friend or foe by factions", () => {
  it("no disposition comparison outside the faction files and the justified exceptions", () => {
    const sites = [];
    for ( const file of FILES.filter(f => !["adapter/factions.mjs", "core/factions.mjs"].includes(f) && !/testing/.test(f)) ) {
      const text = code(file);
      for ( const m of text.matchAll(/disposition\s*(?:===|!==|==)|(?:===|!==)\s*[\w.?]*disposition\b|TOKEN_DISPOSITIONS\.(?:HOSTILE|FRIENDLY|NEUTRAL)/g) ) {
        sites.push({ file, line: lineAt(text, m.index), fn: enclosing(text, m.index).name, ok: false, what: m[0] });
      }
    }
    const { bad, stale } = check(sites, DISPOSITION_EXCEPTIONS);
    expect(bad).toEqual([]);
    expect(stale).toEqual([]);
  });
});

/* -------------------------------------------- */
/*  10. A token moves through token.move()
/* -------------------------------------------- */

/**
 * V14: a token `update({ x, y, elevation })` short-circuits the waypoints and the movement budget, and an elevation change
 * through a floor is refused without an error (foundry-core-notes/v14-migration.md). The engine always moves through
 * `token.move(…, { action })` (`displace`, `blink`, `climb`…).
 */
describe("circulation 10 — a token moves through move()", () => {
  it("aucun update({ x | y | elevation }) dans adapter/ ni runtime/", () => {
    const bad = [];
    for ( const file of FILES.filter(f => /^(adapter|runtime)\//.test(f) && !/testing/.test(f)) ) {
      const text = code(file);
      for ( const m of text.matchAll(/\.update\(\s*\{\s*(?:x|y|elevation)\s*:/g) ) bad.push(`${file}:${lineAt(text, m.index)}`);
    }
    expect(bad).toEqual([]);
  });
});
