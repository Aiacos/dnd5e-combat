/**
 * Le registre de déclencheurs en marche : publier un moment, retrouver ce qui s'y accroche, et
 * exécuter ici les étapes que personne d'autre n'exécute (dégâts bonus). Les réactions
 * (runtime/reactions.mjs) et les zones (runtime/areas.mjs) consultent le même registre.
 */

import { MODULE_ID } from "../constants.mjs";
import { select, stepsOf, BEARER_MOMENTS, damagedByOriginSide, sameActivity, spareBearer } from "../core/triggers.mjs";
import { declarationsOf, declarationsOfEffects, factsFor, tokenOf, consumedMarks, bonusTurnKey, bonusSpent, bonusKeyOf, declaredRollDisadvantage } from "../adapter/triggers.mjs";
import { identifierOf } from "../adapter/content.mjs";
import { comesFromItemEffect, originItemOf } from "../adapter/facts.mjs";
import { usageTokenOf, speakerTokenOf, turnKeyAt } from "../adapter/turn.mjs";
import { resaveAgainst } from "../adapter/areas.mjs";
import { seesBetween } from "../adapter/vision.mjs";
import { tallySettled } from "../core/tally.mjs";
import { turnWentBack } from "../core/turn.mjs";
import { leaveTrace } from "../adapter/traces.mjs";
import { foreignDamageShare, disarmForeignDamageShare } from "../adapter/interop.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { isDeadActor } from "../adapter/death.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, loc, say, locEsc, notice } from "./shared.mjs";
import { takenParts, returnedDamage } from "../core/damage-return.mjs";
import { sideOf } from "../adapter/factions.mjs";
import { samePlane } from "../adapter/plane.mjs";
import { shownActivityOf, usesHolderOf } from "../adapter/uses.mjs";
import { tidyDice } from "../core/formula-tidy.mjs";

/**
 * L'activité de sauvegarde à rejouer : celle d'où vient l'effet, ou, pour un effet posé par une attaque dont la sauvegarde est
 * enchaînée (sauvegarde sœur, onHit.save, §19.6), la sauvegarde de son item.
 */
export function saveActivityOf(activity) {
  if ( !activity || (activity.type === "save") ) return activity;
  return activity.item?.system?.activities?.find?.(a => a.type === "save") ?? activity;
}

/**
 * C12-e : la sauvegarde qu'une étape `resave` déclare elle-même (`ability`) — au DD de sorts du lanceur de l'activité.
 * @returns {{ability: string, dc: number}|null}
 */
function declaredSave(activity, ability) {
  const dc = Number(activity?.item?.actor?.system?.attributes?.spell?.dc);
  return Number.isFinite(dc) ? { ability, dc } : null;
}

/** Fait connaître un moment aux consommateurs passifs (SPEC §5.6). */
export function announce(moment, context) {
  Hooks.callAll(`${MODULE_ID}.${moment}`, context);
}

/**
 * Les déclarations de `context.actor` qui s'accrochent à ce moment, sans rien publier : celles de ses
 * items, et, aux moments « du porteur » (son tour, être attaqué), celles que portent les effets posés sur lui
 * (`via: "effect"`).
 */
export function matching(moment, context) {
  if ( !context.actor ) return [];
  // §225 : rien ne s'accroche d'un plan à l'autre (réaction, dégâts bonus, protection d'un allié) — l'Éthéré ne touche que l'Éthéré.
  const others = [context.source ?? context.sourceToken, context.target ?? context.targetToken].filter(Boolean);
  if ( others.some(other => !samePlane(context.actor, other)) ) return [];
  // O9h (§363) : un effet porté par l'auteur ajoute aussi ses dégâts bonus (Potion des pugilistes : la potion bue n'existe plus).
  const declarations = (BEARER_MOMENTS.includes(moment) || (moment === "preDamageRoll"))
    ? [...declarationsOf(context.actor), ...declarationsOfEffects(context.actor)]
    : declarationsOf(context.actor);
  return select(declarations, moment, factsFor(context));
}

/** Publie le moment, et rend ce qui s'y accroche. */
export function fire(moment, context) {
  announce(moment, context);
  return matching(moment, context);
}

/* -------------------------------------------- */
/*  Dégâts bonus (preDamageRoll)                */
/* -------------------------------------------- */

const partKey = s => `${s.name}|${s.formula}|${s.damageType}`;

/**
 * Sur le client de l'auteur, avant le dialogue du jet de dégâts : les déclarations de ses items
 * qui s'accrochent à `preDamageRoll` ajoutent leur part au jet (Maléfice). Un jet vaut pour toutes
 * ses cibles : une part n'est ajoutée que si chaque cible la justifie ; sinon on le dit.
 */
function onPreRollDamage(config, dialog, message) {
  const activity = config.subject;
  const source = activity?.actor;
  if ( !activity || !source || !canvas?.ready || !config.rolls ) return true;
  const origin = usageTokenOf(activity);
  // §373 : les cibles du coup lui-même (carte du jet de dégâts, comme maximizeOnHit) d'abord — la sélection de l'utilisateur peut avoir été
  // relâchée entre l'attaque et ce jet (une prise après le coup résolue entre-temps) ; sinon la sélection.
  const carded = (foundry.utils.getProperty(message ?? {}, "data.system.targets") ?? [])
    .map(t => fromUuidSync(t.token ?? "", { strict: false })).filter(Boolean);
  const targets = (carded.length ? carded : Array.from(game.user.targets).map(t => t.document)).filter(t => (t !== origin) && t.actor);
  if ( !targets.length ) return true;

  // `damageType: "weapon"` : le type de l'arme (première part de dégâts de l'activité, sinon de l'item).
  const weaponType = activity.damage?.parts?.[0]?.types?.first?.() ?? Array.from(activity.damage?.parts?.[0]?.types ?? [])[0]
    ?? Array.from(activity.item?.system?.damage?.base?.types ?? [])[0] ?? null;
  const typeOf = s => (s.damageType === "weapon") ? weaponType : s.damageType;
  const perTarget = targets.map(target => fire("preDamageRoll", { actor: source, source, target: target.actor, activity, sourceToken: origin, targetToken: target })
    .flatMap(d => stepsOf(d, "damage").filter(s => typeOf(s)).map(s => ({ name: d.name, formula: s.formula, damageType: typeOf(s),
      once: (d.oncePerTurn === true) ? bonusKeyOf(d) : null, spends: s.spends ?? null, identifier: d.identifier ?? null,
      key: bonusKeyOf(d), ask: d.ask ?? null, item: d.item ?? null }))));
  const candidates = new Map(perTarget.flat().map(s => [partKey(s), s]));
  if ( !candidates.size ) return true;
  // §223 (#12) : une part au choix (`ask`, Frappe effroyable) n'est mise que si l'auteur l'a acceptée avant le jet
  // (adapter/messages.mjs, `rollDamageForAttack`) ; un jet lancé hors du moteur n'en a pas.
  const accepted = config[MODULE_ID]?.acceptedBonuses ?? [];
  for ( const s of Array.from(candidates.values()).filter(x => x.ask && !accepted.includes(x.key)) ) {
    candidates.delete(partKey(s));
    log(`bonus damage: ${s.name} not chosen`);
  }
  if ( !candidates.size ) return true;
  // §19.9 : « une fois par tour » (Attraction de la mort) — n'importe quel tour, en combat ; marqué sur l'acteur de l'auteur.
  const turn = bonusTurnKey();
  const spent = s => bonusSpent(source, s.once);
  const agreed = Array.from(candidates.values()).filter(s => !spent(s) && perTarget.every(list => list.some(o => partKey(o) === partKey(s))));
  for ( const s of agreed ) {
    if ( s.once && turn ) source.setFlag(MODULE_ID, `oncePerTurn.${s.once}`, turn).catch(err => console.warn(`${MODULE_ID} | ${s.name}: turn not marked`, err));
  }
  for ( const s of Array.from(candidates.values()).filter(spent) ) log(`bonus damage: ${s.name} already used this turn`);
  const dropped = Array.from(candidates.values()).filter(s => !agreed.includes(s) && !spent(s));
  if ( dropped.length ) ui.notifications.warn(loc("DegatsBonusDivergents", { names: dropped.map(s => s.name).join(", ") }));

  // §74 : une part qui dépense un effet de son item porté par l'auteur (Frappe du zéphyr) — il tombe, ces dégâts sont les derniers.
  for ( const s of agreed.filter(x => x.spends) ) {
    const spent = (source.appliedEffects ?? source.effects ?? []).filter(e => comesFromItemEffect(e, s.spends)
      && (!s.identifier || (identifierOf(originItemOf(e) ?? {}).id === s.identifier)));
    for ( const e of spent ) e.delete().then(() => log(`${s.name}: "${e.name}" spent`), err => console.warn(`${MODULE_ID} | ${e.name}: not removed`, err));
  }
  // §223 : une part au choix dépense une utilisation de l'activité qui en tient le compte (Frappe effroyable : Sagesse par repos long).
  for ( const s of agreed.filter(x => x.ask?.uses) ) {
    const uses = usesHolderOf(shownActivityOf(fromUuidSync(s.item ?? "", { strict: false }), s.ask.uses));
    if ( uses ) uses.spend()
      .then(() => log(`${s.name}: one use spent`), err => console.warn(`${MODULE_ID} | ${s.name}: use not spent`, err));
  }
  const data = activity.getRollData();
  // §438 : la formule écrite avec les données de l'acteur et ses groupes de nombres calculés (`2d(6 + 2 * min(1, floor(5 / 11)))` → `2d6`),
  // pour le jet et pour ce que la carte en montre.
  for ( const s of agreed ) {
    try { s.formula = tidyDice(Roll.replaceFormulaData(s.formula, data, { missing: "0" })); } catch {}
  }
  for ( const s of agreed ) {
    // Même forme qu'une part du système (data/activity/base-activity.mjs:933-939) ; le critique
    // s'applique à toutes les parts du jet, dés bonus compris (règle 2024).
    // §161 : une liste de types — dnd5e en propose le choix au jet (Invocation d'élémentaires mineurs : acide, froid, feu, foudre).
    const types = [s.damageType].flat();
    config.rolls.push({ data, parts: [s.formula], options: { type: types[0], types, properties: [] } });
    log(`bonus damage: ${s.name} +${s.formula} ${types.join("/")}`);
  }
  if ( agreed.length ) foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.bonuses`, agreed);
  return true;
}

/* -------------------------------------------- */
/*  Tour de la créature (startOfTurn, endOfTurn)  */
/* -------------------------------------------- */

/**
 * Une déclaration du tour, à part des autres : une étape qui échoue (effet déjà supprimé, jet refusé) est consignée sous le nom de
 * la déclaration, et les autres effets de la créature jouent quand même leur tour.
 */
async function apart(d, token, moment, play) {
  try { await play(); }
  catch(err) { console.error(`${MODULE_ID} | ${d.name}: turn trigger failed on ${token.name} (${moment})`, err); }
}

/**
 * Le tour d'une créature commence ou finit, où qu'elle soit : les déclarations portées par ses effets
 * (Immobilisation de personne : « réitère le JS à la fin de chacun de ses tours ») rejouent la sauvegarde
 * de l'activité d'origine (adapter/areas.mjs, resaveAgainst). §19 : elles lui infligent aussi des dégâts
 * (`damage`, `to: "bearer"` : Flèche acide de Melf, Infliger des cauchemars), puis l'effet peut tomber (`remove`).
 * MJ actif uniquement ; une file par créature.
 */
function turnMoment(moment, combatant, turnKey=null) {
  const token = combatant?.token;
  const actor = token?.actor;
  if ( !actor ) return;
  return enqueue(`turn:${token.uuid}`, async () => {
    // §484 : la créature est aussi `self` — un trait qui la regarde elle-même (`self.inSunlight`).
    const declarations = fire(moment, { actor, target: actor, source: null, targetToken: token, self: actor, selfToken: token });
    for ( const d of declarations ) await apart(d, token, moment, async () => {
      // §484 : un trait de la créature (sans effet posé) lui inflige des dégâts à son tour (Hypersensibilité au soleil).
      if ( d.via === null ) return selfDamage(d, token, moment);
      // §42.2 : « à la fin de son PROCHAIN tour » — un effet que le moteur fait tomber lui-même (`remove`) et qui a été posé
      // pendant ce tour-ci attend le suivant (`placedOn`, noté à la pose : runtime/cantrips.mjs).
      if ( turnKey && stepsOf(d, "remove").length && ((await fromUuid(d.effect ?? ""))?.getFlag?.(MODULE_ID, "placedOn") === turnKey) ) return;
      // Sauvegarde répétée et dégâts du porteur ensemble : les dégâts ne valent que si la sauvegarde est ratée (Épine de
      // Par exemple : une sauvegarde à chaque début de tour, 1d6 dégâts si elle échoue ; §19.6) — ils
      // voyagent avec la carte de sauvegarde, que la résolution applique (runtime/engine.mjs, `resave.onFail`).
      const bearerDamage = stepsOf(d, "damage").filter(s => s.to === "bearer");
      const resaves = stepsOf(d, "resave");
      for ( const step of resaves ) {
        const effect = await fromUuid(d.effect ?? "");
        // Un effet posé par un palier de PV (`hpTiers`) peut ne pas nommer son activité : celle de l'item.
        const origin = (await fromUuid(d.activity ?? "")) ?? (step.ability ? (await fromUuid(d.item ?? ""))?.system?.activities?.contents?.[0] : null);
        const activity = saveActivityOf(origin);
        // C12-e : `ability` — la sauvegarde que la donnée n'a pas (Mot de pouvoir étourdissant), au DD de sorts du lanceur.
        const declared = step.ability ? declaredSave(activity, step.ability) : null;
        if ( !effect || ((activity?.type !== "save") && !declared) ) { log(`${d.name}: repeated saving throw impossible (effect or save activity not found)`); continue; }
        // §43.1 : le seuil d'échecs du compteur est atteint — plus de sauvegarde.
        if ( step.tally && tallySettled(effect.getFlag(MODULE_ID, "tally")) ) continue;
        // §403 : Compulsion — la sauvegarde n'est rejouée qu'après la marche imposée par le lanceur (runtime/compulsion.mjs).
        if ( step.ifCompelled ) {
          if ( !effect.getFlag(MODULE_ID, "compelled")?.moved ) { log(`${d.name}: ${token.name} was not directed this turn, no saving throw`); continue; }
          await effect.unsetFlag(MODULE_ID, "compelled");
        }
        // §42.2 : Terreur — la sauvegarde n'est rejouée que si la créature finit son tour sans voir le lanceur.
        if ( step.unlessSeesOrigin && (seesBetween(actor, activity.item?.actor ?? null) !== false) ) {
          log(`${d.name}: ${token.name} still sees the caster, no saving throw (${moment})`);
          continue;
        }
        log(`${d.name}: ${token.name} repeats the saving throw (${moment})`);
        const onFail = bearerDamage.length
          ? { item: d.item, identifier: d.identifier, name: d.name, scaling: effect.getFlag?.("dnd5e", "scaling") ?? 0,
            steps: bearerDamage.map(({ formula, damageType, activity: id }) => ({ formula, damageType, activity: id })) }
          : null;
        // §37 : `keep` (réussie, l'effet reste) et `onFail: "dodge"` (ratée, l'action Esquiver) — Malédiction, « Cursed Actions ».
        await resaveAgainst(effect, activity, token, moment, { onFail, keep: step.keep === true, dodge: step.onFail === "dodge", tally: step.tally ?? null, save: declared,
          // §495 (brique B15) : l'échelle d'états — ses paliers sont des effets de l'item qui porte la règle.
          stages: step.stages ? { item: d.item ?? null, stages: step.stages, onSuccess: step.onSuccess ?? "down", critEnds: step.critEnds === true } : null });
      }
      if ( resaves.length && bearerDamage.length ) return;
      for ( const step of bearerDamage ) {
        const effect = await fromUuid(d.effect ?? "");
        if ( !effect ) continue;
        const item = await fromUuid(d.item ?? "");
        // §157 : une activité de soin (Héroïsme : PV temporaires au début de chaque tour) passe par le même chemin — ses dés ont le
        // type « temphp » ou « healing », que dnd5e applique comme un soin.
        const heals = (item?.system?.activities?.get?.(step.activity ?? "")?.type === "heal") || ["healing", "temphp"].includes(step.damageType);
        // Issue #40 : une créature morte ne subit plus les dégâts de son tour.
        if ( spareBearer({ dead: isDeadActor(actor), heals }) ) { log(`${d.name}: ${token.name} is dead, no damage (${moment})`); continue; }
        await inflict({
          step, item, scaling: effect.getFlag?.("dnd5e", "scaling") ?? 0, targetUuid: token.uuid,
          speaker: ChatMessage.implementation.getSpeaker({ token }),
          flavor: loc(heals ? "SoinsPorteur" : "DegatsPorteur", { item: d.name, name: token.name }),
          flags: { bearerDamage: { item: d.identifier, effect: d.effect, moment } }
        });
        log(`${d.name}: ${token.name} takes its damage (${moment})`);
      }
      if ( stepsOf(d, "remove").length ) {
        const effect = await fromUuid(d.effect ?? "");
        if ( effect ) { await effect.delete(); log(`${d.name}: the effect ends on ${token.name} (${moment})`); }
      }
    });
  });
}

/**
 * §484 : les dégâts qu'un trait inflige à son porteur à son tour (`to: "self"`, sans effet posé) — « au début de son tour au soleil, elle
 * subit 20 dégâts radiants » ; la condition (`if`) a déjà été tenue par `fire`. Une créature morte n'en subit plus (issue #40).
 */
async function selfDamage(d, token, moment) {
  const actor = token.actor;
  const steps = stepsOf(d, "damage").filter(s => s.to === "self");
  if ( !steps.length ) return;
  const item = await fromUuid(d.item ?? "");
  for ( const step of steps ) {
    const heals = (item?.system?.activities?.get?.(step.activity ?? "")?.type === "heal") || ["healing", "temphp"].includes(step.damageType);
    if ( spareBearer({ dead: isDeadActor(actor), heals }) ) { log(`${d.name}: ${token.name} is dead, no damage (${moment})`); continue; }
    await inflict({
      step, item, targetUuid: token.uuid,
      speaker: ChatMessage.implementation.getSpeaker({ token }),
      flavor: loc(heals ? "SoinsPorteur" : "DegatsPorteur", { item: d.name, name: token.name }),
      flags: { selfDamage: { item: d.identifier, moment } }
    });
    log(`${d.name}: ${token.name} takes its own trait's damage (${moment})`);
  }
}

/**
 * §334 : au début du tour d'une créature, les effets qu'elle a posés sur d'autres (`originTurnStart`, porté par l'effet) — leur porteur
 * subit ses dégâts (Submersion, Tourbillon, Mâchonner : « at the start of each of the …'s turns »).
 */
function originTurnMoment(combatant) {
  const origin = combatant?.actor;
  const scene = combatant?.token?.parent;
  if ( !origin || !scene ) return;
  const tasks = [];
  for ( const token of scene.tokens ) {
    const actor = token.actor;
    if ( !actor || (actor === origin) || !actor.effects?.size ) continue;
    tasks.push(enqueue(`turn:${token.uuid}`, async () => {
      const declarations = fire("originTurnStart", { actor, target: actor, source: origin, targetToken: token });
      for ( const d of declarations ) await apart(d, token, "originTurnStart", async () => {
        const item = await fromUuid(d.item ?? "");
        if ( !item?.actor || (item.actor.uuid !== origin.uuid) ) return;
        const effect = await fromUuid(d.effect ?? "");
        if ( !effect ) return;
        for ( const step of stepsOf(d, "damage").filter(s => s.to === "bearer") ) {
          // Issue #40 : ni ceux du tour de la créature qui a posé l'effet.
          if ( spareBearer({ dead: isDeadActor(actor), heals: false }) ) { log(`${d.name}: ${token.name} is dead, no damage (start of ${origin.name}'s turn)`); continue; }
          await inflict({
            step, item, scaling: effect.getFlag?.("dnd5e", "scaling") ?? 0, targetUuid: token.uuid,
            speaker: ChatMessage.implementation.getSpeaker({ token }),
            flavor: loc("DegatsPorteur", { item: d.name, name: token.name }),
            flags: { bearerDamage: { item: d.identifier, effect: d.effect, moment: "originTurnStart" } }
          });
          log(`${d.name}: ${token.name} takes its damage (start of ${origin.name}'s turn)`);
        }
      });
    }));
  }
  return Promise.all(tasks);
}

function onTurnChange(combat, prior, current) {
  // « Tour précédent » : le tour quitté ne finit pas, celui où l'on revient ne recommence pas — ni dégâts ni sauvegarde rejoués.
  if ( turnWentBack(prior, current) ) return;
  // Les tâches reviennent au routeur : une file qui échoue est consignée sous le libellé de l'inscription, au lieu de se perdre.
  return Promise.all([
    turnMoment("endOfTurn", combat.combatants.get(prior?.combatantId), turnKeyAt(combat, prior)),
    turnMoment("startOfTurn", combat.combatants.get(current?.combatantId)),
    originTurnMoment(combat.combatants.get(current?.combatantId))
  ]);
}

/* -------------------------------------------- */
/*  Marques consommées au jet d'attaque (B10)   */
/* -------------------------------------------- */

/**
 * Un jet d'attaque vient d'être lancé (message `attack`, touché ou raté) : les marques qu'il concerne tombent — Rayon
 * traçant (« la prochaine attaque contre elle »), Moquerie cruelle (« sa prochaine attaque »). Elles ont donné leur
 * avantage ou leur désavantage au jet (B6, adapter/triggers.mjs, `declaredAttackModifiers`). MJ actif uniquement.
 * L'attaque qui POSE la marque (Rayon traçant) la pose après son propre jet : elle ne la consomme pas.
 */
async function onAttackRolled(message) {
  const sourceToken = speakerTokenOf(message);
  if ( !sourceToken ) return;
  const activity = message.getAssociatedActivity?.() ?? null;
  const removed = new Set();
  for ( const t of message.system?.targets ?? [] ) {
    const targetToken = fromUuidSync(t.token, { strict: false });
    for ( const mark of consumedMarks(sourceToken, targetToken, activity) ) {
      if ( removed.has(mark.effect) ) continue;
      removed.add(mark.effect);
      const effect = await fromUuid(mark.effect);
      if ( !effect ) continue;
      await effect.delete();
      log(`${mark.name}: ${mark.bearer}'s mark consumed by ${sourceToken.name}'s attack`);
    }
  }
}

/* -------------------------------------------- */
/*  Dégâts subis par le porteur d'un effet (isDamaged)  */
/* -------------------------------------------- */

/**
 * La créature vient de perdre des PV ou des PV temporaires, d'où que viennent les dégâts (résolution du
 * moteur, plateau du système, barre du token) : `dnd5e.damageActor`, émis sur tous les clients par
 * `onUpdateHP` (data/actor/templates/attributes.mjs) quand le total PV + PV temporaires baisse. Les effets
 * qu'elle porte réagissent (`via: "effect"`) : B8 `remove` — l'effet cesse (Sommeil, Motif hypnotique) ;
 * B4 `resave` — elle rejoue la sauvegarde (Domination, Fou rire). MJ actif uniquement.
 * Limite : à 0 PV sans PV temporaires, les PV ne baissent plus et le hook ne vient pas.
 */
/** Délai au-delà duquel l'auteur noté des derniers dégâts ne vaut plus (des PV écrits à la main ensuite n'en ont pas). */
const DAMAGER_FRESH_MS = 10000;

/**
 * §65 : `dnd5e.preApplyDamage`, sur le client qui applique : l'auteur des dégâts (l'acteur du message de dégâts — carte du moteur
 * en `origin`, bouton de dnd5e en `originatingMessage`) part dans la même écriture que les PV ; inconnu (barre du token,
 * dégâts tapés), il est effacé. Lu par `onDamaged` pour les déclarations `by: "originSide"`.
 */
function recordDamager(actor, amount, updates, options) {
  if ( !(amount > 0) || !actor ) return;
  const message = [options?.origin, options?.originatingMessage].find(m => m instanceof ChatMessage) ?? null;
  const damager = message?.getAssociatedActor?.() ?? null;
  // §294 : l'activité d'où viennent les dégâts, pour `by: "otherActivity"`.
  const activity = message?.getAssociatedActivity?.()?.uuid ?? null;
  // §499 : les parts subies (type, montant, multiplicateur), notées au calcul de ces mêmes dégâts (même objet `options`).
  const parts = options ? (CALCULATED.get(options) ?? null) : null;
  updates[`flags.${MODULE_ID}.damagedBy`] = { uuid: damager?.uuid ?? null, activity, at: Date.now(), parts };
}

/** §499 : les parts calculées par dnd5e pour une application en cours, par son objet `options` (calcul puis application, même appel). */
const CALCULATED = new WeakMap();

/** §499 : `dnd5e.calculateDamage` (actor.mjs, après résistances) — les parts, gardées pour `recordDamager`. Un aperçu ne s'applique pas. */
function noteCalculated(actor, damages, options) {
  if ( options && (typeof options === "object") ) CALCULATED.set(options, takenParts(damages));
}

/** §499 : l'auteur noté des derniers dégâts, s'il est frais : `{ uuid, activity, parts }`, ou null. */
function freshDamager(actor) {
  const noted = actor?.getFlag?.(MODULE_ID, "damagedBy");
  return (noted && ((Date.now() - (noted.at ?? 0)) <= DAMAGER_FRESH_MS)) ? noted : null;
}

/**
 * §499 (B19) : la riposte du même montant (`damage { to: "source", same }`) — l'auteur des dégâts que le porteur vient de subir les
 * subit à son tour (ses propres résistances comptent), carte et avis pour toute la table.
 */
async function returnDamage(actor, d, step, noted) {
  const attacker = noted?.uuid ? fromUuidSync(noted.uuid, { strict: false }) : null;
  if ( !attacker || (attacker === actor) || (attacker.uuid === actor.uuid) || !((attacker.system?.attributes?.hp?.value ?? 0) > 0) ) {
    log(`${d.name}: no attacker to return the damage to`);
    return;
  }
  const damages = returnedDamage(noted.parts ?? [], { same: step.same, damageType: step.damageType ?? null });
  if ( !damages.length ) { log(`${d.name}: nothing to return (${noted.parts ? "no part kept" : "damage parts unknown"})`); return; }
  const n = damages.reduce((sum, p) => sum + p.value, 0);
  await attacker.applyDamage(damages.map(p => ({ value: p.value, type: p.type })));
  const types = damages.map(p => CONFIG.DND5E.damageTypes?.[p.type]?.label ?? p.type).join(", ");
  log(`${d.name}: ${attacker.name} takes ${n} damage back (${damages.map(p => `${p.value} ${p.type}`).join(", ")})`);
  const attackerToken = tokenOf(attacker);
  await say({ actor }, locEsc("RenvoiDegats.Carte", { item: d.name, name: attacker.name, n, types }),
    { returned: { item: d.identifier, from: actor.uuid, to: attacker.uuid, amount: n, damages } });
  if ( attackerToken ) notice(attackerToken, { key: "RenvoiDegats.Avis", data: { n } }, "info", { all: true, action: "damageReturned", outcome: "success" });
}

/** La disposition du token d'un acteur sur la scène affichée, ou null. */
function dispositionOf(actor) {
  const token = actor ? tokenOf(actor) : null;
  return (token?.document ?? token)?.disposition ?? null;
}

/** §181 : le camp du token d'un acteur sur la scène affichée, ou null. */
function sideOfActor(actor) {
  const token = actor ? tokenOf(actor) : null;
  return token ? sideOf(token) : null;
}

/** §65 : les dégâts que l'acteur vient de subir viennent-ils du lanceur de l'effet ou d'un de ses alliés ? */
function byOriginSide(actor, d) {
  const noted = actor.getFlag(MODULE_ID, "damagedBy");
  if ( !noted?.uuid || ((Date.now() - (noted.at ?? 0)) > DAMAGER_FRESH_MS) ) return false;
  const damager = fromUuidSync(noted.uuid, { strict: false });
  const origin = d.source ? fromUuidSync(d.source, { strict: false }) : null;
  return damagedByOriginSide({ damager: damager?.uuid ?? null, origin: origin?.uuid ?? null,
    damagerDisposition: dispositionOf(damager), originDisposition: dispositionOf(origin),
    damagerSide: sideOfActor(damager), originSide: sideOfActor(origin) });
}

/** §294 : les dégâts que l'acteur vient de subir viennent-ils d'une autre activité que celle qui a posé l'effet ? Inconnue : oui. */
function byOtherActivity(actor, d) {
  const noted = actor.getFlag(MODULE_ID, "damagedBy");
  if ( !noted?.activity || ((Date.now() - (noted.at ?? 0)) > DAMAGER_FRESH_MS) ) return true;
  return !sameActivity(noted.activity, d.activity);
}

function onDamaged(actor, changes) {
  if ( !(changes?.total < 0) || !actor ) return;
  const token = tokenOf(actor);
  const tokenDocument = token?.document ?? token ?? null;
  // §499 : l'activité et les types des dégâts subis, s'ils sont connus et frais (`activity.isMelee`, `damage.hasType`).
  const noted = freshDamager(actor);
  const hurtBy = noted?.activity ? fromUuidSync(noted.activity, { strict: false }) : null;
  const damageTypes = noted?.parts ? [...new Set(noted.parts.map(p => p.type))] : null;
  const declarations = matching("isDamaged", { actor, target: actor, source: null, targetToken: tokenDocument, activity: hurtBy, damageTypes })
    .filter(d => (d.via === "effect") && d.effect)
    // §65 : « si vous ou vos alliés lui infligez des dégâts » (Suggestion) — les autres dégâts ne comptent pas.
    .filter(d => (d.by !== "originSide") || byOriginSide(actor, d))
    .filter(d => (d.by !== "otherActivity") || byOtherActivity(actor, d));
  if ( !declarations.length ) return;
  return enqueue(`damaged:${actor.uuid}`, async () => {
    for ( const d of declarations ) {
      const effect = await fromUuid(d.effect);
      if ( !effect ) continue;   // déjà tombé (deux déclarations du même item, ou retiré entre-temps)
      if ( stepsOf(d, "remove").length ) {
        await effect.delete();
        log(`${d.name}: ends on ${actor.name}, who just took damage`);
        await say({ actor }, locEsc("FinSurDegats", { name: actor.name, item: d.name }),
          { ended: { effect: d.effect, item: d.identifier, actor: actor.uuid, moment: "isDamaged" } });
        continue;
      }
      // Lien protecteur (§16.11) : le lanceur de l'effet subit le même montant (ou la formule déclarée).
      for ( const step of stepsOf(d, "damage").filter(s => s.to === "origin") ) {
        // §156 : le moteur partage toujours ; un module qui le ferait aussi est désarmé avant (ci-dessous), et encore ici au besoin.
        const owner = await disarmForeignDamageShare(effect).catch(() => null);
        if ( owner ) log(`${d.name}: damage sharing by ${owner} disarmed, the engine shares`);
        const origin = await fromUuid(d.source ?? "");
        if ( !origin || (origin === actor) || !((origin.system?.attributes?.hp?.value ?? 0) > 0) ) continue;
        const amount = step.formula ? (await new Roll(step.formula).evaluate()).total : -changes.total;
        if ( !(amount > 0) ) continue;
        await origin.applyDamage(step.formula ? [{ value: amount, type: step.damageType }] : amount);
        log(`${d.name}: ${origin.name} takes ${amount} damage along with ${actor.name}`);
        await say({ actor: origin }, locEsc("PartageDegats", { name: origin.name, item: d.name, n: amount, bearer: actor.name }),
          { shared: { item: d.identifier, from: actor.uuid, to: origin.uuid, amount } });
      }
      // §499 (B19) : la riposte du même montant.
      for ( const step of stepsOf(d, "damage").filter(s => (s.to === "source") && ("same" in s)) ) await returnDamage(actor, d, step, noted);
      const resave = stepsOf(d, "resave")[0];
      if ( !resave ) continue;
      const activity = saveActivityOf(await fromUuid(d.activity ?? ""));
      if ( (activity?.type !== "save") || !tokenDocument ) { log(`${d.name}: saving throw on damage impossible (save activity or token not found)`); continue; }
      log(`${d.name}: ${actor.name} repeats the saving throw (damage taken)`);
      await resaveAgainst(effect, activity, tokenDocument, "isDamaged", { advantage: resave.advantage === true });
    }
  });
}

/**
 * §156 : un effet dont l'item déclare un partage de dégâts vers le lanceur (Lien protecteur), qu'un autre module marque pour le
 * faire aussi (BLFX, après la création de l'effet) : sa marque est désarmée — sinon le lanceur paierait deux fois.
 */
async function onEffectMarked(effect) {
  if ( !foreignDamageShare(effect) || (effect.parent?.documentName !== "Actor") ) return;
  const shares = declarationsOfEffects(effect.parent)
    .some(d => (d.effect === effect.uuid) && [d.on].flat().includes("isDamaged") && stepsOf(d, "damage").some(s => s.to === "origin"));
  if ( !shares ) return;
  const owner = await disarmForeignDamageShare(effect);
  if ( owner ) log(`${effect.name}: damage sharing by ${owner} disarmed, the engine shares`);
}

/**
 * §484 : sur le client qui lance, un test de caractéristique (compétences, initiative) ou une sauvegarde avec le Désavantage qu'un trait
 * déclare sous condition (`rollDisadvantage` : « au soleil, Désavantage aux tests de caractéristique »). La fenêtre de jet de dnd5e le
 * montre ; le MJ peut l'écarter à la main.
 */
const onPreRollDisadvantage = kind => config => {
  const actor = config?.subject;
  const roll = config?.rolls?.[0];
  if ( (actor?.documentName !== "Actor") || !roll ) return true;
  const names = declaredRollDisadvantage(actor, kind);
  if ( !names.length ) return true;
  roll.options ??= {};
  roll.options.disadvantage = true;
  log(`${actor.name}: ${kind} (${config.ability ?? config.skill ?? "?"}) with Disadvantage (${names.join(", ")})`);
  return true;
};

export function registerTriggers() {
  route("dnd5e.preRollAbilityCheckV2", onPreRollDisadvantage("check"), { label: "declared Disadvantage on ability checks" });
  route("dnd5e.preRollSavingThrowV2", onPreRollDisadvantage("save"), { label: "declared Disadvantage on saving throws" });
  route("createActiveEffect", onEffectMarked, { executor: true, label: "Warding Bond: foreign damage sharing not disarmed" });
  route("updateActiveEffect", onEffectMarked, { executor: true, label: "Warding Bond: foreign damage sharing not disarmed" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "trigger bonus damage" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "creature's turn: triggers interrupted" });
  route("dnd5e.calculateDamage", noteCalculated, { label: "damage taken: parts not noted" });
  route("dnd5e.preApplyDamage", recordDamager, { label: "damage taken: source not recorded" });
  route("dnd5e.damageActor", onDamaged, { executor: true, label: "damage taken: bearer's effects not handled" });
  // Trace d'une utilisation (§16.9, contenu `trace: true`) : pas pour un rejeu de zone ni une sauvegarde répétée.
  // Marques consommées (§16.12, B10) : au message du jet d'attaque.
  route("createChatMessage", async message => {
    if ( message.type === "attack" ) return onAttackRolled(message);
    if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
    const effect = await leaveTrace(message);
    if ( effect ) log(`${effect.name}: trace placed on ${effect.parent?.name}`);
  }, { executor: true, label: "trace or mark not handled" });
}
