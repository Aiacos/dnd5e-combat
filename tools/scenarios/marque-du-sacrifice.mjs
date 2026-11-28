/**
 * §456: `leavesEffects` — Mark of Sacrifice (Ravenloft, Boon). Removed from the sheet, it leaves the bearer the "(Removed)" effect
 * from its data: Disadvantage on Wisdom saving throws, 24 hours. A test actor receives the Boon; the item is removed by the
 * connector; the actor bears the effect (Wisdom change, duration 86,400 s, origin = the Boon), the chat card is said. A
 * second actor without the Boon receives nothing when another item is removed from them. Actors removed.
 */
const MODULE_ID = "dnd5e-combat";
const UUID = "Compendium.dnd-ravenloft-horrors-within.items.Item.rhwMarkofSacriXa";
const EFFECT = "Mark of Sacrifice (Removed)";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Marque du sacrifice — retirée, elle laisse son Désavantage de Sagesse (leavesEffects)",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 60000 });
    const res = await ctx.call("get-compendium-entry", { uuid: UUID }).catch(() => null);
    if ( !res?.data ) { ctx.log("Ravenloft (Marque du sacrifice) absent : non applicable"); return; }
    const actors = [];
    ctx.restore(() => api("diagnosticForget", { uuids: [], dropPack: false, actors }));
    const { _id, folder, ownership, _stats, ...itemData } = JSON.parse(JSON.stringify(res.data));
    itemData._stats = { compendiumSource: UUID };
    const make = async (name, items) => {
      const created = await ctx.call("create-actor", { actorData: { name, type: "character",
        flags: { [MODULE_ID]: { scenario: "marque-du-sacrifice" } }, items } });
      const id = created.id ?? created.actorId ?? created.actor?._id;
      if ( id ) actors.push(id);
      return id;
    };
    const actorId = await make("Marqué (scénario)", [itemData]);
    if ( !ctx.expect(!!actorId, "acteur créé avec la Marque du sacrifice") ) return;
    const sheet = async id => ctx.call("get-actor", { actorId: id });
    const before = await sheet(actorId);
    const mark = (before.items ?? []).find(i => i.name === itemData.name);
    ctx.expect(!!mark, "la Bénédiction est sur la fiche");
    ctx.expect(!(before.effects ?? []).some(e => e.name === EFFECT), "avant : l'acteur ne porte pas l'effet");

    await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: mark._id });
    let effect = null;
    for ( let i = 0; i < 30 && !effect; i++ ) {
      await pause(300);
      effect = ((await sheet(actorId)).effects ?? []).find(e => e.name === EFFECT) ?? null;
    }
    ctx.log(`après : ${effect ? `${effect.name} — ${JSON.stringify(effect.system?.changes ?? effect.changes)} — ${effect.duration?.value} ${effect.duration?.units}` : "rien"}`);
    ctx.expect(!!effect, "l'objet retiré laisse l'effet « (Removed) » sur l'acteur");
    ctx.expect((effect?.system?.changes ?? effect?.changes ?? []).some(c => c.key === "system.abilities.wis.save.roll.mode"), "Désavantage aux sauvegardes de Sagesse");
    ctx.expect(effect?.duration?.value === 86400, `24 heures (${effect?.duration?.value} ${effect?.duration?.units})`);
    ctx.expect(effect?.origin === UUID, `origine : la Bénédiction (${effect?.origin})`);
    ctx.expect(!((await sheet(actorId)).items ?? []).some(i => i.name === itemData.name), "la Bénédiction a bien quitté la fiche");

    // Another item removed, without `leavesEffects`: nothing.
    const plainId = await make("Témoin (scénario)", [{ name: "Torch", type: "loot", system: {} }]);
    const plain = ((await sheet(plainId)).items ?? [])[0];
    await ctx.call("remove-embedded-item", { documentType: "Actor", id: plainId, itemId: plain._id });
    await pause(1500);
    ctx.expect(!((await sheet(plainId)).effects ?? []).length, "un objet ordinaire retiré ne laisse rien");
  }
};
