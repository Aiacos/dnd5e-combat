/**
 * §203: the diagnostic redoes the compendium translation for texts left in the original language. On an actor created
 * for the test, coming from a translated Monster Manual creature but left in English (name, prototype token), which carries a
 * fully English Ammunition of Impact (name, description, activities, enchantment) and in which one text was edited by hand:
 * "Texts left in the original language" finds them; repaired (backup first), everything is in French except the edited text.
 * Restores everything: actor, backup entries, and the compendium if it did not exist before.
 */
const MODULE_ID = "dnd5e-combat";
const WALLOPING = "Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgWallopingAmmu";
const SKIRMISHER = "Compendium.dnd-monster-manual.actors.mmAarakocraSkirm";
const HAND = "<p>Texte écrit à la main par le MJ.</p>";

export default {
  name: "diagnostic — textes restés en anglais, traduction du compendium reprise",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 120000 });
    const item = await ctx.call("get-compendium-entry", { uuid: WALLOPING }).catch(() => null);
    const creature = await ctx.call("get-compendium-entry", { uuid: SKIRMISHER }).catch(() => null);
    const itemOrig = item?.data?.flags?.babele?.originalPayload;
    const actorOrig = creature?.data?.flags?.babele?.originalPayload;
    if ( !itemOrig || !actorOrig ) { ctx.log("compendiums non traduits sur ce client : non applicable"); return; }
    const packBefore = (await ctx.call("list-compendiums", {}).catch(() => [])) ?? [];
    const hadPack = JSON.stringify(packBefore).includes("world.das-backups");
    const backups = [];
    const actors = [];
    ctx.restore(() => api("diagnosticForget", { uuids: backups, dropPack: !hadPack, actors }));
    // §204: otherwise the sheet would be translated as soon as it is created, before the analysis.
    const auto = await api("setting", { key: "autoTranslate", value: false });
    ctx.restore(() => api("setting", { key: "autoTranslate", value: auto.before }));

    // The item put back in its original language, from the values Babele keeps; its card text edited by hand.
    const { _id, folder, ownership, _stats, ...itemData } = foundry_clone(item.data);
    itemData.name = itemOrig.name;
    itemData.system.description.value = itemOrig.description;
    itemData.system.description.chat = HAND;
    for ( const [id, a] of Object.entries(itemOrig.activities ?? {}) ) {
      const activity = itemData.system.activities?.[id];
      if ( !activity ) continue;
      activity.name = a.name;
      if ( activity.activation ) activity.activation.condition = a.condition;
      if ( activity.description ) activity.description.chatFlavor = a.chatFlavor;
    }
    const origEffect = Object.values(itemOrig.effects ?? {})[0];
    for ( const e of itemData.effects ?? [] ) if ( origEffect ) e.name = origEffect.name;
    itemData._stats = { compendiumSource: WALLOPING };
    // A second item without a recorded identifier (dnd5e derives it from the name): renamed, it must keep the one
    // derived from the English name.
    const bare = foundry_clone(itemData);
    bare.system.identifier = "";
    const bareId = slug(itemOrig.name);

    const created = await ctx.call("create-actor", { actorData: {
      name: actorOrig.name, type: "npc", prototypeToken: { name: actorOrig.name },
      // The source through the old flag, which the check also reads: the connector does not pass `_stats` on creation.
      flags: { core: { sourceId: SKIRMISHER }, [MODULE_ID]: { scenario: "diagnostic-traduction" } }, items: [itemData, bare]
    } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, `acteur de test créé en anglais (${actorOrig.name}, ${itemOrig.name})`) ) return;
    const root = `Actor.${actorId}`;

    const scan = await api("diagnosticScan", { checks: ["retranslate"] });
    const mine = (scan.retranslate ?? []).filter(t => t.root?.uuid === root);
    ctx.expect(mine.length === 3 && mine.every(t => t.fixable), `analyse : l'acteur et l'objet sont trouvés (${mine.map(t => t.text).join(" | ") || "rien"})`);

    const repaired = await api("diagnosticRepair", { checks: ["retranslate"], roots: [root] });
    if ( repaired.backup?.uuid ) backups.push(repaired.backup.uuid);
    ctx.expect(repaired.results.length === 3 && repaired.results.every(r => r.ok), `réparation : ${repaired.results.map(r => r.line).join(" | ") || "aucune"}`);

    const after = await ctx.call("get-actor", { actorId });
    ctx.expect(after.name === creature.data.name, `nom de la créature traduit (${after.name})`);
    const it = (after.items ?? []).find(i => i.system?.identifier === item.data.system?.identifier);
    const pinned = (after.items ?? []).find(i => i !== it);
    ctx.expect(pinned?.system?.identifier === bareId, `identifiant figé avant de renommer (${pinned?.name} : « ${pinned?.system?.identifier} », attendu « ${bareId} »)`);
    ctx.expect(it?.name === item.data.name, `nom de l'objet traduit (${it?.name})`);
    // Foundry cleans the HTML on save: compared by its start, and never English again.
    const desc = it?.system?.description?.value ?? "";
    ctx.expect((desc !== itemOrig.description) && desc.startsWith(item.data.system.description.value.slice(0, 30)), `description de l'objet traduite (${desc.slice(0, 50)})`);
    ctx.expect(it?.system?.description?.chat === HAND, "le texte modifié à la main n'a pas bougé");
    const acts = Object.entries(it?.system?.activities ?? {});
    ctx.expect(acts.every(([id, a]) => a.name === item.data.system.activities[id]?.name), `activités traduites (${acts.map(([, a]) => a.name).join(", ")})`);
    const names = (it?.effects ?? []).map(e => e.name);
    ctx.expect(!!names.length && !names.includes(origEffect?.name), `enchantement traduit (${names.join(", ")})`);

    const again = await api("diagnosticScan", { checks: ["retranslate"] });
    ctx.expect(!(again.retranslate ?? []).some(t => t.root?.uuid === root), "une nouvelle analyse ne trouve plus rien sur cet acteur");
  }
};

/** Comme `formatIdentifier` de dnd5e (utils.mjs) : minuscules, sans accents, tirets. */
function slug(name) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function foundry_clone(data) {
  return JSON.parse(JSON.stringify(data));
}
