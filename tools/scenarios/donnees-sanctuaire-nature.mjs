/**
 * §454 : Sanctuaire de dame Nature (Druide, Cercle de la Terre). Le compendium (SRD 6.1 `classes24`, Manuel des joueurs 3.0.0) a perdu
 * les quatre effets de l'aptitude ; `dataFixes` les recrée et fait pointer chaque activité « Place Sanctuary » vers l'effet de son
 * terrain. Un acteur de test reçoit l'aptitude du Manuel (sinon celle du SRD) : le MJ actif la corrige à la création — quatre effets
 * « Nature's Ward » (abri partiel + Résistance du terrain), une activité = un effet. §456 : Coup brutal du Manuel aussi (l'id orphelin de
 * « Sundering Blow » retiré), et l'analyse « Aptitudes et sorts du Manuel 3.0.0 » ne propose plus de remplacer ces deux objets corrigés
 * (elle compare à la référence corrigée). Acteur retiré.
 */
const MODULE_ID = "dnd5e-combat";
const SOURCES = ["Compendium.dnd-players-handbook.classes.Item.phbdrdNaturesSan", "Compendium.dnd5e.classes24.Item.phbdrdNaturesSan"];
const LANDS = { dnd5eactivity000: ["h0xW0mOYF8frKgHf", "fire"], aNIM3GrB97GSNZHG: ["7YVMASgXswIFXNs2", "cold"],
  G1htmQaxEZ0kwRK0: ["Gqgjm2NswU6f7qVL", "lightning"], "0FT3EzkaLnht95Eo": ["LKxwXqkEIXJR2XAa", "poison"] };
const BRUTAL = "Compendium.dnd-players-handbook.classes.Item.phbbrbBrutalStri";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "donnée premium — Sanctuaire de dame Nature (effets perdus recréés)",

  async run(ctx) {
    const api = (fn, args={}) => ctx.engine(fn, args, { timeoutMs: 60000 });
    let uuid = null, data = null;
    for ( const u of SOURCES ) {
      const res = await ctx.call("get-compendium-entry", { uuid: u }).catch(() => null);
      if ( res?.data ) { uuid = u; data = res.data; break; }
    }
    if ( !data ) { ctx.log("Sanctuaire de dame Nature introuvable (ni Manuel ni SRD 6.1) : non applicable"); return; }
    ctx.log(`source : ${uuid}`);
    const actors = [];
    ctx.restore(() => api("diagnosticForget", { uuids: [], dropPack: false, actors }));
    const setting = await api("setting", { key: "dataFixes" });
    ctx.restore(() => api("setting", { key: "dataFixes", value: setting.before }));
    await api("setting", { key: "dataFixes", value: true });

    const { _id, folder, ownership, _stats, ...itemData } = JSON.parse(JSON.stringify(data));
    itemData._stats = { compendiumSource: uuid };
    ctx.expect(!(itemData.effects ?? []).length, `la donnée du compendium n'a aucun effet (${(itemData.effects ?? []).length})`);
    const brutal = await ctx.call("get-compendium-entry", { uuid: BRUTAL }).catch(() => null);
    const items = [itemData];
    if ( brutal?.data ) {
      const { _id: bid, folder: bf, ownership: bo, _stats: bs, ...b } = JSON.parse(JSON.stringify(brutal.data));
      b._stats = { compendiumSource: BRUTAL };
      items.push(b);
    }
    const created = await ctx.call("create-actor", { actorData: { name: "Sanctuaire (donnée)", type: "character",
      flags: { [MODULE_ID]: { scenario: "donnees-sanctuaire-nature" } }, items } });
    const actorId = created.id ?? created.actorId ?? created.actor?._id;
    if ( actorId ) actors.push(actorId);
    if ( !ctx.expect(!!actorId, "acteur créé avec l'aptitude") ) return;

    let item = null;
    for ( let i = 0; i < 40; i++ ) {
      await pause(500);
      item = ((await ctx.call("get-actor", { actorId })).items ?? []).find(it => it.system?.identifier === "natures-sanctuary");
      if ( (item?.effects ?? []).length >= 4 ) break;
    }
    const effects = item?.effects ?? [];
    ctx.log(`effets : ${effects.map(e => `${e.name} [${(e.statuses ?? []).join(",")}] ${(e.system?.changes ?? []).map(c => c.value).join(",")}`).join(" | ") || "aucun"}`);
    ctx.expect(effects.length === 4, `quatre effets « Nature's Ward » recréés (${effects.length})`);
    for ( const [activity, [effectId, type]] of Object.entries(LANDS) ) {
      const effect = effects.find(e => e._id === effectId);
      ctx.expect(!!effect && (effect.statuses ?? []).includes("coverHalf") && (effect.system?.changes ?? []).some(c => c.value === type),
        `${effect?.name ?? effectId} : abri partiel et Résistance (${type})`);
      const ids = (item?.system?.activities?.[activity]?.effects ?? []).map(e => e._id);
      ctx.expect((ids.length === 1) && (ids[0] === effectId), `l'activité ${item?.system?.activities?.[activity]?.name ?? activity} ne pose que son effet (${ids.join(", ")})`);
    }
    if ( brutal?.data ) {
      let strike = null;
      for ( let i = 0; i < 20; i++ ) {
        strike = ((await ctx.call("get-actor", { actorId })).items ?? []).find(it => it.system?.identifier === "brutal-strike");
        if ( (strike?.system?.activities?.MP1qQsApCj19F2M5?.effects ?? []).length === 1 ) break;
        await pause(500);
      }
      const ids = (strike?.system?.activities?.MP1qQsApCj19F2M5?.effects ?? []).map(e => e._id);
      ctx.expect((ids.length === 1) && (ids[0] === "Q0ou16II1WEcCdyW"), `Coup brutal : « Sundering Blow » ne cite plus que « Sundered » (${ids.join(", ")})`);
    }
    if ( uuid.includes("dnd-players-handbook") ) {
      const scan = await api("diagnosticScan", { checks: ["phb3-items"] });
      const mine = (scan["phb3-items"] ?? []).filter(t => t.root?.uuid === `Actor.${actorId}`);
      ctx.log(`phb3-items : ${mine.map(t => t.text).join(" | ") || "rien"}`);
      ctx.expect(!mine.length, "« Aptitudes et sorts du Manuel 3.0.0 » ne propose pas de remplacer les objets corrigés");
    }
  }
};
