/**
 * §491 : fait `target.wearsArmor` — Avantage déclaré (`preAttackRoll`) contre une cible en armure de métal. Arène de test, Guerrier et
 * Bandit. Un trait d'essai prêté au Guerrier : « Avantage si la cible porte une armure en métal ». Les armures équipées du Bandit sont
 * ôtées le temps du scénario, puis il revêt des armures du SRD 2024 de dnd5e :
 *  1. sans armure : pas d'Avantage ;
 *  2. cotte de mailles : Avantage ; la même marquée `flags.dnd5e-combat.metal = false` : plus d'Avantage ;
 *  3. armure de cuir : pas d'Avantage ; marquée `metal = true` (armure de campagne) : Avantage.
 * Lu par l'outil `attackReasons` (les raisons que le moteur donnerait au jet), sans jet.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.equipment24.Item.";
const BODY = ["light", "medium", "heavy", "shield"];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "cible en armure de métal §491 — fait target.wearsArmor, Avantage déclaré",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Bandit absent : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const items = async actorId => (await ctx.call("get-actor", { actorId })).items ?? [];

    // Le trait d'essai, sur le Guerrier.
    const r = await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: SHOCK, match: { path: "system.identifier", value: SHOCK.system.identifier } });
    const traitId = r.itemId ?? r.id ?? r.item?._id ?? (await ctx.itemId(fighter.id, SHOCK.system.identifier));
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: fighter.actorId, itemId: traitId }).catch(() => {}));
    const weapon = (await items(fighter.actorId)).find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack")
      && !i.flags?.[MODULE_ID]?.basicAction);
    if ( !ctx.expect(!!weapon, "le Guerrier a une arme d'attaque") ) return;

    // Les armures du Bandit ôtées (remises à la fin).
    const worn = (await items(bandit.actorId)).filter(i => (i.type === "equipment") && i.system?.equipped && BODY.includes(i.system?.type?.value));
    const equip = (id, on) => ctx.call("upsert-actor-item", { actorId: bandit.actorId, itemData: { "system.equipped": on }, match: { path: "_id", value: id } });
    for ( const i of worn ) { await equip(i._id, false); ctx.restore(() => equip(i._id, true).catch(() => {})); }

    const lent = [];
    ctx.restore(async () => { for ( const id of lent ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: bandit.actorId, itemId: id }).catch(() => {}); });
    const wear = async (id, mark, metal) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid: `${SRD}${id}` });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.system = { ...itemData.system, equipped: true };
      itemData.flags = { ...(itemData.flags ?? {}), [MODULE_ID]: { scenarioArmor: mark, ...(metal === undefined ? {} : { metal }) } };
      const res = await ctx.call("upsert-actor-item", { actorId: bandit.actorId, itemData, match: { path: `flags.${MODULE_ID}.scenarioArmor`, value: mark } });
      if ( !lent.includes(res.id) ) lent.push(res.id);
      return res.id;
    };
    const setMetal = (id, metal) => ctx.call("upsert-actor-item", { actorId: bandit.actorId, itemData: { [`flags.${MODULE_ID}.metal`]: metal },
      match: { path: "_id", value: id } });
    const advantaged = async () => {
      await pause(800);
      const reasons = await ctx.engine("attackReasons", { attackerId: fighter.id, targetId: bandit.id, itemId: weapon._id });
      return { yes: reasons.advantage.some(k => k.startsWith("content.")), list: reasons.advantage.join(", ") || "aucune" };
    };

    let a = await advantaged();
    ctx.expect(!a.yes, `Bandit sans armure : pas d'Avantage déclaré (${a.list})`);

    const mail = await wear("phbarmChainMail0", "mail");
    a = await advantaged();
    ctx.expect(a.yes, `Bandit en cotte de mailles : Avantage déclaré (${a.list})`);
    await setMetal(mail, false);
    a = await advantaged();
    ctx.expect(!a.yes, `cotte de mailles marquée « pas en métal » : plus d'Avantage (${a.list})`);
    await equip(mail, false);

    const leather = await wear("phbarmLeatherArm", "leather");
    a = await advantaged();
    ctx.expect(!a.yes, `Bandit en armure de cuir : pas d'Avantage (${a.list})`);
    await setMetal(leather, true);
    a = await advantaged();
    ctx.expect(a.yes, `armure de cuir marquée « en métal » (armure de campagne) : Avantage (${a.list})`);
  }
};

/* Le trait d'essai (déclaré après le scénario : son titre est le premier `name`). */
const SHOCK = {
  name: "Décharge contre le métal (essai)", type: "feat", img: "icons/magic/lightning/bolt-forked-blue.webp",
  system: { identifier: "das-test-shock-vs-metal", type: { value: "monster" }, description: { value: "<p>Essai §491.</p>" } },
  flags: { [MODULE_ID]: {
    triggers: [{ on: "preAttackRoll", if: { "target.wearsArmor": { material: "metal" } }, do: [{ type: "advantage" }] }]
  } }
};
