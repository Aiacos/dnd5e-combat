/**
 * §204: an item or a creature created from a translated compendium, but left in English (player without the right to browse
 * the files, client in another language, translation that does not translate effect names), takes the translation right away —
 * without going through the diagnostic. Setting `autoTranslate`: on, a creature created in English with its items is
 * translated (an item without a recorded identifier keeps the one derived from the English name); an item added later to
 * the sheet too, including the table case (translated name, "Walloping Ammunition" enchantment); setting off, nothing moves.
 */
const MODULE_ID = "dnd5e-combat";
const WALLOPING = "Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgWallopingAmmu";
const SKIRMISHER = "Compendium.dnd-monster-manual.actors.mmAarakocraSkirm";

export default {
  name: "traduction à la création — objets et créatures restés en anglais",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 60000 });
    const item = await ctx.call("get-compendium-entry", { uuid: WALLOPING }).catch(() => null);
    const creature = await ctx.call("get-compendium-entry", { uuid: SKIRMISHER }).catch(() => null);
    const itemOrig = item?.data?.flags?.babele?.originalPayload;
    const actorOrig = creature?.data?.flags?.babele?.originalPayload;
    if ( !itemOrig || !actorOrig ) { ctx.log("compendiums non traduits sur ce client : non applicable"); return; }
    const auto = await api("setting", { key: "autoTranslate", value: true });
    ctx.restore(() => api("setting", { key: "autoTranslate", value: auto.before }));
    const actors = [];
    ctx.restore(() => api("diagnosticForget", { uuids: [], dropPack: false, actors }));

    const origEffect = Object.values(itemOrig.effects ?? {})[0]?.name;
    const english = () => {
      const { _id, folder, ownership, _stats, ...data } = clone(item.data);
      data.name = itemOrig.name;
      data.system.description.value = itemOrig.description;
      for ( const [id, a] of Object.entries(itemOrig.activities ?? {}) ) if ( data.system.activities?.[id] ) data.system.activities[id].name = a.name;
      for ( const e of data.effects ?? [] ) e.name = origEffect;
      data._stats = { compendiumSource: WALLOPING };
      return data;
    };
    const bare = english();
    bare.system.identifier = "";
    const create = async (name, flags, items) => {
      const created = await ctx.call("create-actor", { actorData: { name, type: "npc", prototypeToken: { name }, flags, items } });
      const id = created.id ?? created.actorId ?? created.actor?._id;
      if ( id ) actors.push(id);
      return id;
    };
    const settle = async (actorId, test) => {
      for ( let i = 0; i < 20; i++ ) {
        const a = await ctx.call("get-actor", { actorId });
        if ( test(a) ) return a;
        await new Promise(r => setTimeout(r, 300));
      }
      return ctx.call("get-actor", { actorId });
    };

    // 1. A creature created in English, with two items in English.
    const actorId = await create(actorOrig.name, { core: { sourceId: SKIRMISHER }, [MODULE_ID]: { scenario: "traduction-creation" } }, [english(), bare]);
    if ( !ctx.expect(!!actorId, `créature créée en anglais (${actorOrig.name})`) ) return;
    const after = await settle(actorId, a => (a.name === creature.data.name) && (a.items ?? []).every(i => i.name === item.data.name));
    ctx.expect(after.name === creature.data.name, `nom de la créature traduit à la création (${after.name})`);
    const items = after.items ?? [];
    ctx.expect(items.length === 2 && items.every(i => i.name === item.data.name), `objets traduits à la création (${items.map(i => i.name).join(", ")})`);
    ctx.expect(items.every(i => (i.effects ?? []).every(e => e.name !== origEffect)), `enchantements traduits (${items.flatMap(i => (i.effects ?? []).map(e => e.name)).join(", ")})`);
    // The complete item keeps its compendium identifier; the one that had none receives the one derived from its English name.
    const ids = items.map(i => i.system?.identifier).sort();
    ctx.expect(JSON.stringify(ids) === JSON.stringify([item.data.system.identifier, "walloping-ammunition"].sort()), `identifiants gardés (${ids.join(", ")})`);

    // 2. An item added afterwards: the table case, translated name and enchantment left in English.
    const laurent = clone(item.data);
    delete laurent._id;
    // The connector removes `_stats` from an item added to a sheet: the source via the old flag, which the engine reads too.
    laurent.flags = { ...(laurent.flags ?? {}), core: { sourceId: WALLOPING } };
    for ( const e of laurent.effects ?? [] ) e.name = origEffect;
    await ctx.call("upsert-embedded-item", { documentType: "Actor", id: actorId, itemData: laurent });
    const added = await settle(actorId, a => (a.items ?? []).length === 3 && (a.items ?? []).every(i => (i.effects ?? []).every(e => e.name !== origEffect)));
    const third = (added.items ?? []).find(i => !items.some(j => j._id === i._id));
    ctx.expect(!!third && (third.effects ?? []).every(e => e.name === item.data.name), `objet ajouté : enchantement traduit (${(third?.effects ?? []).map(e => e.name).join(", ")})`);

    // 3. Setting off: nothing moves.
    await api("setting", { key: "autoTranslate", value: false });
    const offId = await create(actorOrig.name, { core: { sourceId: SKIRMISHER }, [MODULE_ID]: { scenario: "traduction-creation" } }, [english()]);
    await new Promise(r => setTimeout(r, 2000));
    const off = await ctx.call("get-actor", { actorId: offId });
    ctx.expect((off.name === actorOrig.name) && ((off.items ?? [])[0]?.name === itemOrig.name), `réglage coupé : laissé en anglais (${off.name}, ${(off.items ?? [])[0]?.name})`);
  }
};

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}
