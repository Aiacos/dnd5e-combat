/**
 * The sweep of the "Spell Arena" (2026-10-22, gap survey): each item of a list — spells, feats, features — lent to the
 * Caster (`tools/arene-sorts.mjs`), each of its activities used once on the target that its data designates (area placed
 * on the Target, healing on the Ally, personal item on the Caster), and invariants that do not depend on the dice:
 *  1. the use takes place (dnd5e does not refuse it);
 *  2. an attack or save activity receives a resolution from the engine, and it is settled (not blocked along the way);
 *  3. HP read on each target = damage recorded by the resolution (healing included, as negative);
 *  4. an activity that sets effects sets them on the target that is hit / that misses (or with no roll), and on no one else
 *     than the targets of the resolution;
 *  5. a Concentration spell leaves the Caster concentrating;
 *  6. a spell of level ≥ 1 spends a slot of its level, only one (`consume: true`);
 *  7. no error in the GM's console during the use;
 *  8. (§406, option `upcast`, `MONTEE=2` of the spell sweep) cast `upcast` levels above its own, a spell whose data
 *     have rising dice (`scaling` of a damage part or of the healing) rolls the right number of dice (double accepted on a
 *     Critical Hit), and spends the slot of that level. Only these activities are played.
 * Outside the sweep: summoning, transformation and forwarding (`forward`) activities, teleportations and walls placed point by
 * point (they wait for a click). Report: `prive/balayages/<kind>-<date>.json` and `.md` (names and findings, no item text).
 * Scenarios: `balayage-sorts`, `balayage-aptitudes` (only played when named).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { CONTENT } from "../../module/scripts/content/index.mjs";
import { ARENE_SORTS } from "./stages.mjs";

const SLOTS = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 9, override: 9 }]));
const SKIPPED_TYPES = new Set(["summon", "transform", "forward"]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * §406: the dice an activity must roll `increase` levels above its spell, from its data — same computation as
 * `DamageData#scaledFormula` of dnd5e 6.0.6 (dnd5e.mjs:19627): "whole" mode (each level) or "half" (every other level),
 * `scaling.number` more dice on the first die, `scaling.formula` added as many times. Returns `[{ count, faces, part }]` for the
 * parts that scale only (empty: the activity has no rising dice).
 * @param {object} activity  Activity data (compendium): `damage.parts` or `healing`.
 * @param {number} increase
 */
export function upcastDice(activity, increase) {
  const parts = activity?.damage?.parts?.length ? activity.damage.parts : (activity?.healing ? [activity.healing] : []);
  const out = [];
  parts.forEach((part, i) => {
    const sc = part?.scaling ?? {};
    const steps = (sc.mode === "whole") ? increase : ((sc.mode === "half") ? Math.floor(increase / 2) : 0);
    if ( !steps || !(Number(sc.number) > 0 || sc.formula) ) return;
    const more = (Number(sc.number) || 0) * steps;
    if ( more ) {
      const custom = part.custom?.enabled ? /^(\d+)d(\d+)/.exec(String(part.custom.formula ?? "").trim()) : null;
      if ( custom ) out.push({ count: Number(custom[1]) + more, faces: Number(custom[2]), part: i });
      else if ( !part.custom?.enabled && part.number && part.denomination ) out.push({ count: part.number + more, faces: Number(part.denomination), part: i });
    }
    const extra = sc.formula ? /^(\d+)d(\d+)$/.exec(String(sc.formula).trim()) : null;
    if ( extra ) out.push({ count: Number(extra[1]) * steps, faces: Number(extra[2]), part: i, formula: true });
  });
  return out;
}

/**
 * §406: the expected dice (`upcastDice`) missing from the rolled formulas. An expected die is found when a formula has a term
 * of the same size and of that number, or of double (Critical Hit). Returns the readable gaps ("5d8 expected"), empty if all
 * is there.
 * @param {{count: number, faces: number}[]} expected
 * @param {string[]} formulas
 */
export function missingDice(expected, formulas) {
  const terms = formulas.flatMap(f => [...String(f ?? "").matchAll(/(\d+)d(\d+)/g)].map(m => ({ count: Number(m[1]), faces: Number(m[2]) })));
  return expected.filter(e => !terms.some(t => (t.faces === e.faces) && ((t.count === e.count) || (t.count === 2 * e.count))))
    .map(e => `${e.count}d${e.faces} attendu`);
}

/**
 * @param {object} ctx  the context of a scenario (tools/scenario.mjs)
 * @param {object} options
 * @param {string} options.kind        name of the report ("spells", "features")
 * @param {string[]} options.packs     compendiums read
 * @param {(data: object) => boolean} options.select   the items swept
 * @param {(data: object) => string} options.sortKey   the sweep order
 * @param {object} options.lend        `system` tweaks on loan (a prepared spell…)
 * @param {boolean} options.consume    spend the resources (slots)
 * @param {string} [options.caster]    the token that casts ("Caster" by default; a PC copy for the audit of a sheet)
 * @param {() => Promise<{itemId: string, data: object}[]>} [options.items]  the caster's OWN items, instead of the compendiums:
 *                                     nothing is lent or removed (audit of a sheet, `audit-pj`)
 * @param {number} [options.upcast]    §406: cast each spell this many levels above its own, and only play the activities
 *                                     whose dice rise (invariant 8)
 */
export async function sweep(ctx, { kind, packs = [], select, sortKey, lend = {}, consume, caster: casterName = "Lanceur", items, upcast = 0 }) {
  const names = Object.keys(ARENE_SORTS.tokens);
  const { tokens } = await ctx.scene();
  if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log("tokens de l'arène manquants : lancer tools/arene-sorts.mjs"); return; }
  const t = Object.fromEntries(await Promise.all(names.map(async n => [n, await ctx.token(n)])));
  // Another caster (PC copy): the arena's Caster stays on the scene (kept), but out of the sweep.
  const keep = new Set(Object.values(t).map(x => x.id));
  if ( casterName !== "Lanceur" ) { delete t["Lanceur"]; t[casterName] = await ctx.token(casterName); keep.add(t[casterName].id); }
  const caster = t[casterName];
  const grid = ARENE_SORTS.grid;
  const sceneId = (await ctx.scene()).sceneId;

  // The items: compendium indexes, sweep filters — or the caster's own items.
  const docs = items ? (await items()).filter(d => select(d.data)) : [];
  for ( const packId of (items ? [] : packs) ) {
    const index = await ctx.call("list-compendium-entries", { packId });
    for ( const e of (Array.isArray(index) ? index : Object.values(index).find(Array.isArray)) ?? [] ) {
      if ( !["spell", "feat"].includes(e.type) ) continue;
      const { data } = await ctx.call("get-compendium-entry", { uuid: e.uuid });
      if ( select(data) ) docs.push({ uuid: e.uuid, data });
    }
  }
  docs.sort((a, b) => sortKey(a.data).localeCompare(sortKey(b.data)));
  const from = process.env.DEPUIS ? docs.findIndex(d => d.data.system.identifier === process.env.DEPUIS) : 0;
  const list = docs.slice(Math.max(0, from));
  ctx.log(`${list.length} item(s) à balayer`);

  const centre = async tok => { const b = await ctx.box(tok); return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }; };
  const px = feet => (Number(feet) || 0) / 5 * grid;
  const slotsOf = async () => (await ctx.call("get-actor", { actorId: caster.actorId })).system?.spells ?? {};
  const tokenOf = tr => Object.values(t).find(x => (x.id === tr.tokenId) || (x.name === tr.name));
  /** HP and Temporary Hit Points (arena's linked actors): Temporary Hit Points healing (Armor of Agathys, False Life) counts too. */
  const hpOf = async tok => {
    const hp = (await ctx.call("get-actor", { actorId: tok.actorId })).system?.attributes?.hp ?? {};
    return (Number(hp.value) || 0) + (Number(hp.temp) || 0);
  };

  // The effects already there (those of a PC sheet: species, feats, worn items) are never removed.
  const baseline = new Set();
  for ( const tok of Object.values(t) ) for ( const e of (await ctx.call("get-actor", { actorId: tok.actorId })).effects ?? [] ) baseline.add(e._id ?? e.id);

  /** All that a use left behind: effects, areas, summoned tokens, HP, slots, windows. */
  const cleanup = async () => {
    for ( const tok of Object.values(t) ) {
      const actor = await ctx.call("get-actor", { actorId: tok.actorId });
      for ( const e of (actor.effects ?? []).filter(x => !baseline.has(x._id ?? x.id)) ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: tok.actorId, effectId: e._id ?? e.id }).catch(() => {});
      await ctx.setHp(tok, 999);
    }
    const { objects } = await ctx.call("list-scene-objects", { sceneId, types: ["Token", "Region", "Wall", "AmbientLight", "Tile"] });
    for ( const [type, found] of Object.entries(objects ?? {}) ) {
      for ( const o of found ?? [] ) {
        if ( (type === "Token") && keep.has(o.id) ) continue;
        await ctx.call("delete-scene-object", { sceneId, type, objectId: o.id }).catch(() => {});
      }
    }
    await ctx.call("update-actor", { actorId: caster.actorId, actorData: { system: { spells: { ...SLOTS, pact: { value: 9, override: 9 } } } } });
    for ( const w of await ctx.engine("windows").catch(() => []) ) await ctx.engine("closeWindow", { id: w.id }).catch(() => {});
  };

  /** The target and the area of an activity, from its data. */
  const aim = async (item, activity) => {
    const s = item.system;
    // The activity has its own target and range when it overrides them — and always on a feat or a feature, which has none.
    const target = (activity.target?.override || !s.target) ? activity.target : s.target;
    const range = (activity.range?.override || !s.range) ? activity.range : s.range;
    const template = target?.template?.type ? target.template : null;
    const affects = target?.affects?.type ?? "";
    let who = (activity.type === "heal") || ["ally", "willing"].includes(affects) ? t["Allié"] : t["Cible"];
    if ( ((range?.units === "self") && !template) || (affects === "self") ) who = caster;
    // A melee weapon (attack, and the Grapple of an unarmed strike) targets the enemy in contact: at 6 m, the engine dropped
    // a successful grapple at once, out of reach (Kaalisti audit, 2026-10-29).
    if ( (item.type === "weapon") && ((activity.attack?.type?.value === "melee") || ((activity.type === "save") && (s.type?.value !== "simpleR") && (s.type?.value !== "martialR"))) ) who = t["Ennemi au contact"];
    if ( !template ) return { targets: [who] };
    if ( template.type === "wall" ) return { skip: "mur posé point par point" };
    // A size can be a formula of the spell's level (Confusion: "@item.level * 5 - 10"): evaluated at the base level.
    const formula = String(template.size || 5).replace(/@item\.level/g, String(s.level ?? 0));
    const size = px(/^[\d\s+\-*/().]+$/.test(formula) ? Function(`return (${formula})`)() : 5);
    const onSelf = range?.units === "self";
    const at = await centre(onSelf ? caster : t["Cible"]);
    const near = [t["Cible"], t["Cible voisine"]];
    switch ( template.type ) {
      case "cone": case "line": case "rect": {
        // The Target is at 20 ft: a 15 ft Cone would not reach it. Geometry is not tested here, but what the item does
        // to the creatures caught: the area goes from the Caster to the end of the neighboring Target.
        const c = await centre(caster);
        const far = await centre(t["Cible voisine"]);
        const start = c.box.x + c.box.width;
        const length = Math.max(size, far.box.x + far.box.width - start);
        const width = Math.max(grid * 1.5, template.type === "line" ? px(template.width || 5) : size);
        return { targets: near, area: { shape: "rectangle", x: start, y: far.y - width / 2, width: length, height: width } };
      }
      case "cube": case "square":
        return { targets: near, area: { shape: "rectangle", x: at.x - size / 2, y: at.y - size / 2, width: size, height: size } };
      default:
        // An Emanation around the Caster: the enemy in contact and the Ally are in it (the Caster is not a target of its own area).
        return { targets: onSelf ? [t["Ennemi au contact"], t["Allié"]] : near, area: { shape: "circle", x: at.x, y: at.y, radius: size } };
    }
  };

  const report = [];
  await cleanup();
  for ( const { uuid, itemId: own, data } of list ) {
    const s = data.system;
    const ident = s.identifier;
    const isSpell = data.type === "spell";
    const row = { name: data.name, identifier: ident, level: isSpell ? s.level : (s.requirements ?? ""),
      engine: Object.keys(CONTENT[ident] ?? {}).filter(k => k !== "source"), runs: [], notes: [] };
    report.push(row);
    if ( CONTENT[ident]?.teleport || CONTENT[ident]?.pointWall ) { row.notes.push(`non joué : ${CONTENT[ident]?.teleport ? "téléportation" : "mur point par point"} (attend un clic)`); continue; }
    // §406: when upcasting, only the spells that have an activity with rising dice, and that exist at that level.
    const cast = isSpell ? (s.level ?? 0) + upcast : null;
    if ( upcast && (!isSpell || !(s.level >= 1) || (cast > 9)
      || !Object.values(s.activities ?? {}).some(a => upcastDice(a, upcast).length)) ) { report.pop(); continue; }
    if ( upcast ) row.level = `${s.level} → ${cast}`;
    let itemId = own;
    if ( !own ) try { itemId = await ctx.ensureItem(caster, uuid, { system: lend }); }
    catch ( err ) { row.notes.push(`prêt impossible : ${err.message}`); continue; }
    for ( const activity of Object.values(s.activities ?? {}) ) {
      const label = `${activity.type}${activity.name ? ` « ${activity.name} »` : ""}`;
      if ( SKIPPED_TYPES.has(activity.type) ) { row.notes.push(`${label} : non joué`); continue; }
      const expected = upcast ? upcastDice(activity, upcast) : [];
      if ( upcast && !expected.length ) continue;
      // A "rider" activity that an enchantment of the item gives to its target (the pact weapon's attack): dnd5e hides it on
      // the source item (`isHidden`, `isRider`) and refuses its use; it is played on the enchanted weapon.
      const rider = Object.values(s.activities ?? {}).some(a => (a.effects ?? []).some(e => (e.riders?.activity ?? []).includes(activity._id)));
      if ( rider ) { row.notes.push(`${label} : rider d'enchantement, joué sur l'objet enchanté`); continue; }
      // A smite's damage is rolled after a weapon's hit (§107): used alone, it would strike the Caster.
      if ( CONTENT[ident]?.smite && (activity.type === "damage") ) { row.notes.push(`${label} : non joué (après un coup d'arme)`); continue; }
      const run = { activity: label, issues: [] };
      row.runs.push(run);
      const bad = msg => run.issues.push(msg);
      try {
        const plan = await aim(data, activity);
        if ( plan.skip ) { run.skipped = plan.skip; continue; }
        if ( activity.type === "heal" ) await ctx.setHp(t["Allié"], 500);
        const hp0 = new Map();
        for ( const tok of Object.values(t) ) hp0.set(tok.id, await hpOf(tok));
        const slots0 = await slotsOf();
        await ctx.clientErrors();
        // A question from the engine or from dnd5e to the GM (willing target?, Hex ability, ritual or slot…):
        // first option, noted in the report. It can keep the use pending: we look for it during and just after.
        const known = new Set(((await ctx.call("list-dialogs", {}).catch(() => null))?.windows ?? []).map(w => w.id));
        let done = false;
        let ritualAsked = false;
        const using = ctx.use({ tokenId: caster.id, itemId, activityId: activity._id, targetTokenIds: plan.targets.map(x => x.id),
          consume, ...(plan.area ? { area: plan.area } : {}), ...(upcast ? { usageConfig: { scaling: upcast, spell: { slot: `spell${cast}` } } } : {}) })
          .catch(err => ({ used: false, reason: err.message })).finally(() => { done = true; });
        for ( let after = 0; after < 4; ) {
          const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...known], waitMs: 1500, details: true }).catch(() => null);
          for ( const d of r?.windows ?? [] ) {
            known.add(d.id);
            // Ritual or slot: the slot, so that the spending invariant can be checked.
            const buttons = (d.buttons ?? []).filter(x => !/cancel|annuler|close|fermer/i.test(`${x.action ?? ""} ${x.label ?? ""}`));
            const b = buttons.find(x => /slot|emplacement/i.test(x.label ?? "")) ?? buttons[0] ?? d.buttons?.[0];
            if ( !b ) continue;
            await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
            if ( /slot|emplacement/i.test(b.label ?? "") ) ritualAsked = true;
            row.notes.push(`${label} : fenêtre « ${String(d.title ?? "").slice(0, 60)} » → ${b.label ?? b.action}`);
          }
          if ( done ) after++;
        }
        const used = await using;
        // §139: the "ritual or slot" question cancels the use and relaunches it with the answer, outside `use-activity`.
        if ( !used?.used && ritualAsked ) { run.skipped = "relancé par le moteur après la question rituel / emplacement (§139)"; continue; }
        if ( !used?.used ) { bad(`pas d'utilisation : ${used?.reason ?? "?"}`); continue; }

        // 2. The resolution.
        let r = null;
        if ( used.usageMessageId ) {
          for ( let i = 0; (i < 8) && !r; i++ ) { r = await ctx.resolution(used.usageMessageId); if ( !r ) await pause(500); }
          if ( r ) {
            // `use-activity` cuts the chain of rolls (`subsequentActions: false`, §233): the damage or healing of an activity
            // with no attack roll are rolled like the card's button.
            if ( /^awaiting(Rolls|Damage|Healing)$/.test(r.step ?? "") ) await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(() => {});
            // 60 s: with the GM's chat log hidden, Dice So Nice does not reveal its rolls and each wait for the
            // 3D dice goes to its maximum (8 s) — a weapon with two rolls (attack, damage) and a smite exceeded
            // 25 s (Kaalisti audit, 2026-10-29).
            try { r = await ctx.settle(used.usageMessageId, { timeoutMs: 60000 }); }
            catch ( err ) { bad(`résolution bloquée : ${err.message.replace(/^résolution \S+ /, "")}`); }
          }
        }
        // §401: an area that does not act when placed (`quietPose`: Blizzard, Stinking Cloud) opens no resolution — those
        // inside it save at the start of their turn.
        const quiet = CONTENT[ident]?.quietPose === true;
        if ( ["attack", "save"].includes(activity.type) && !r && !quiet ) bad("aucune résolution du moteur");
        await pause(1500);
        // A spell with projectiles (Eldritch Blast with 2 beams, Scorching Ray) chains its projectiles after the first resolution:
        // we wait until the Target's HP stop moving, otherwise a late ray fell into the next item (Kaalisti audit, 2026-10-29).
        if ( CONTENT[ident]?.projectiles ) {
          let last = await hpOf(t["Cible"]);
          for ( let quiet = 0, i = 0; (quiet < 3) && (i < 30); i++ ) {
            await pause(2000);
            const now = await hpOf(t["Cible"]);
            quiet = (now === last) ? quiet + 1 : 0;
            last = now;
          }
        }
        run.step = r?.step;

        // 3. Les PV.
        for ( const tr of r?.targets ?? [] ) {
          const tok = tokenOf(tr);
          if ( !tok || ((tr.damage?.applied ?? tr.healing?.applied ?? null) === null) ) continue;
          const delta = hp0.get(tok.id) - await hpOf(tok);
          const applied = Number(tr.damage?.applied ?? 0) - Number(tr.healing?.applied ?? 0);
          if ( delta !== applied ) bad(`${tok.name} : PV ${hp0.get(tok.id)} → ${hp0.get(tok.id) - delta}, consigné ${applied}`);
        }

        // 4. Les effets.
        const declared = (activity.effects ?? []).map(e => e._id);
        // An enchantment is set on an item (the weapon), not on a creature: the Caster does not carry it.
        if ( declared.length && !CONTENT[ident]?.zoneEffects && (activity.type !== "enchant") && !quiet ) {
          const affected = r?.targets?.length
            ? r.targets.filter(tr => (tr.hit !== false) && (tr.save?.success !== true) && !tr.unaffected).map(tokenOf).filter(Boolean)
            : plan.targets;
          for ( const tok of affected ) {
            const on = await ctx.effectsFrom(tok, ident);
            if ( on.filter(e => !(e.statuses ?? []).includes("concentrating")).length ) continue;
            // What the target carries anyway (a condition set by the engine under another origin): to sort the finding.
            const worn = ((await ctx.call("get-actor", { actorId: tok.actorId })).effects ?? []).filter(e => !baseline.has(e._id ?? e.id))
              .map(e => `${e.name}${e.origin ? ` ← ${String(e.origin).split(".").slice(-2).join(".")}` : ""}`);
            const tr = r?.targets?.find(x => tokenOf(x) === tok);
            bad(`${tok.name} : aucun effet de l'item (${declared.length} déclaré(s) ; sauvegarde ${tr?.save?.total ?? "?"}${tr?.save ? (tr.save.success ? " réussie" : " ratée") : ""} ; porte : ${worn.join(", ") || "rien"})`);
          }
          const touched = new Set((r?.targets ?? []).map(tr => tr.name).concat(plan.targets.map(x => x.name), [caster.name]));
          // §401: an aura (Aura of Life, Aura of Purity, Pass without Trace) sets its effect on allies in its radius: not a defect.
          if ( !CONTENT[ident]?.aura ) for ( const tok of Object.values(t) ) {
            if ( !touched.has(tok.name) && (await ctx.effectsFrom(tok, ident)).length ) bad(`${tok.name} : effet de l'item posé hors des cibles`);
          }
        }

        // 5. Concentration.
        // Only the activity that casts the spell (it takes the slot) starts Concentration: not "Move Lights".
        if ( isSpell && (s.properties ?? []).includes("concentration") && (activity.consumption?.spellSlot !== false) ) {
          const on = await ctx.effectsFrom(caster, ident);
          // §401: all the targets succeeded on their save or could not be affected — Concentration drops by itself
          // (`endUnaffected` setting): not a defect.
          const nobody = !!r?.targets?.length && r.targets.every(tr => tr.unaffected || (tr.save?.success === true) || (tr.hit === false));
          if ( !on.some(e => (e.statuses ?? []).includes("concentrating")) && !nobody ) bad("Lanceur non concentré");
        }

        // 6. L'emplacement.
        if ( isSpell && consume && (s.level >= 1) ) {
          const slots1 = await slotsOf();
          const spent = Object.keys(SLOTS).map(k => [k, (slots0[k]?.value ?? 0) - (slots1[k]?.value ?? 0)]).filter(([, n]) => n);
          const consumes = activity.consumption?.spellSlot !== false;
          if ( consumes && !((spent.length === 1) && (spent[0][0] === `spell${upcast ? cast : s.level}`) && (spent[0][1] === 1)) ) bad(`emplacement : ${spent.map(([k, n]) => `${k} −${n}`).join(", ") || "aucun dépensé"}`);
          if ( !consumes && spent.length ) bad(`emplacement dépensé par une activité qui n'en prend pas (${spent.map(([k]) => k).join(", ")})`);
        }

        // 8. §406: the dice of the casting level, read on the resolution's damage or healing roll.
        if ( upcast ) {
          const id = r?.damageRoll?.messageId ?? null;
          const m = id ? ((await ctx.call("list-chat-messages", { limit: 80 })).messages ?? []).find(x => x.id === id) : null;
          const formulas = (m?.rolls ?? []).map(raw => ((typeof raw === "string") ? JSON.parse(raw) : raw)?.formula).filter(Boolean);
          run.dice = formulas;
          if ( !id ) run.skipped = `pas de jet de dégâts dans la résolution (${r?.step ?? "pas de résolution"}${r?.targets?.[0]?.hit === false ? ", raté" : ""})`;
          else for ( const miss of missingDice(expected, formulas) ) bad(`niveau ${cast} : ${formulas.join(" + ") || "?"} — ${miss}`);
        }

        // 7. The console (known errors from outside the engine are filtered by the runner, `ctx.clientErrors`).
        const errors = await ctx.clientErrors();
        if ( process.env.PILE ) for ( const e of errors ) console.log(JSON.stringify(e).slice(0, 3000));
        // A feature lent outside its class: its formulas cite a scale or a level that the Caster does not have.
        if ( !isSpell && errors.length && /@(scale|classes)\./.test(JSON.stringify(activity)) ) {
          run.issues.length = 0;
          run.skipped = "formules de classe (échelle, niveau) absentes du Lanceur";
          continue;
        }
        for ( const e of errors ) bad(`erreur : ${[e.message ?? e.text ?? e, e.stack ?? ""].join(" ").replace(/\s+/g, " ").slice(0, process.env.PILE ? 1500 : 200)}`);
      }
      catch ( err ) { bad(`interrompu : ${err.message.slice(0, 200)}`); }
      finally { await cleanup(); }
    }
    if ( !own ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId }).catch(() => {});
    const issues = row.runs.flatMap(x => x.issues.map(i => `${x.activity} — ${i}`));
    ctx.log(`${issues.length ? "✗" : "✓"} ${data.name} (${row.level})${issues.length ? ` : ${issues.join(" ; ")}` : ""}${row.notes.length ? ` [${row.notes.join(" ; ")}]` : ""}`);
    for ( const i of issues ) ctx.expect(false, `${data.name} : ${i}`);
  }

  const date = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  mkdirSync("prive/balayages", { recursive: true });
  writeFileSync(`prive/balayages/${kind}-${date}.json`, JSON.stringify(report, null, 1));
  const spells = kind === "sorts";
  const md = [`| ${spells ? "Sort" : "Item"} | ${spells ? "Niv." : "Niv. / prérequis"} | Moteur | Constats |`, "|---|---|---|---|"].concat(report.map(r => {
    const issues = r.runs.flatMap(x => x.issues.map(i => `${x.activity} : ${i}`).concat(x.skipped ? [`${x.activity} : non joué (${x.skipped})`] : [])).concat(r.notes);
    return `| ${r.name} | ${r.level} | ${r.engine.join(", ")} | ${issues.join(" ; ").replace(/\|/g, "/") || "✓"} |`;
  }));
  writeFileSync(`prive/balayages/${kind}-${date}.md`, md.join("\n") + "\n");
  ctx.log(`rapport : prive/balayages/${kind}-${date}.md`);
}
