/**
 * §493 (B13) — réaction contre une zone : la créature prise dans un cône ou une ligne impose une sauvegarde au lanceur ; ratée, elle
 * seule ne subit pas les dégâts. Exemple synthétique prêté au Zombi, sa règle posée dans la surcouche du monde (`overrideContent` ;
 * pas de drapeau d'item) :
 *   { on: "inArea", if: { "activity.isSpell": true, "activity.areaShape": ["cone", "line"] },
 *     do: [{ type: "use", target: "source" }, { type: "cancelForSelf", ifSourceFails: true }] }
 * L'item : une activité de sauvegarde en réaction, DD 17, Intelligence, Sagesse ou Charisme au choix du lanceur.
 *  1. L'Ensorceleur lance Mains brûlantes (cône), zone posée sur le Zombi, `autoReact: "first"` : la réaction part, la sauvegarde de
 *     l'Ensorceleur décide — ratée : carte « épargné », PV du Zombi inchangés ; réussie : carte « les dégâts passent », PV en baisse du
 *     montant appliqué. On rejoue jusqu'à avoir vu les deux issues (12 essais au plus).
 *  2. Boule de feu (sphère) sur le Zombi : aucune réaction, les dégâts passent.
 * Le réglage « Sauvegarde à plusieurs caractéristiques d'un PNJ » est mis sur « la meilleure » le temps du scénario (aucune fenêtre chez
 * le MJ), le Mage PNJ caché (son Contresort réagirait). États restés sur le Zombi et l'Ensorceleur retirés d'abord ; PV, items, réglage,
 * surcouche remis.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-bouclier-zone";
const ACTIVITY = "dasEssaiBoucZone";
// Noms en constantes : le banc et la référence prennent le premier « name: » indenté de deux espaces pour le titre du scénario.
const ITEM_NAME = "Essai : bouclier de zone";
const ITEM = { name: ITEM_NAME, type: "feat", img: "icons/creatures/invertebrates/fly-wasp-mosquito-green.webp",
  system: { identifier: IDENTIFIER, type: { value: "monster" }, activities: { [ACTIVITY]: { _id: ACTIVITY, type: "save",
    activation: { type: "reaction", value: 1 }, range: { units: "any", override: true }, target: { affects: { type: "creature", count: "1" } },
    save: { ability: ["int", "wis", "cha"], dc: { calculation: "", formula: "17" } } } } } };
const RULE = { triggers: [{ on: "inArea", if: { "activity.isSpell": true, "activity.areaShape": ["cone", "line"] },
  do: [{ type: "use", target: "source" }, { type: "cancelForSelf", ifSourceFails: true }] }] };

export default {
  name: "bouclier-zone — réaction contre un cône : la sauvegarde ratée du lanceur épargne la créature seule (§493, brique B13)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Ensorceleur", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");

    // États restés d'un scénario précédent (À terre, Inconscient…) : retirés d'abord, sur l'acteur du token.
    for ( const t of [sorc, zombi] ) for ( const s of ["dead", "unconscious", "prone", "incapacitated", "stunned", "paralyzed"] ) {
      await ctx.removeStatusEffects(t, s).catch(() => {});
    }
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));

    // Personne d'autre ne réagit : le Mage PNJ caché le temps du scénario.
    for ( const other of tokens.filter(t => (t.name === "Mage") && !t.hidden) ) {
      await ctx.call("update-scene-object", { type: "Token", objectId: other.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: other.id, data: { hidden: false } }).catch(() => {}));
    }

    // Plusieurs caractéristiques au choix : la meilleure, sans fenêtre chez le MJ.
    const choice0 = await ctx.call("get-setting", { namespace: MODULE_ID, key: "npcSaveChoice" }).then(r => r?.value ?? r).catch(() => "ask");
    await ctx.call("set-setting", { namespace: MODULE_ID, key: "npcSaveChoice", value: "best" });
    ctx.restore(() => ctx.call("set-setting", { namespace: MODULE_ID, key: "npcSaveChoice", value: (typeof choice0 === "string") ? choice0 : "ask" }).catch(() => {}));

    // --- Item et règle prêtés ----------------------------------------------------------------------------------------
    const { data: zTok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    await ctx.call("upsert-actor-item", { actorId: zTok.actorId, itemData: ITEM, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(zombi.id, IDENTIFIER);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: zTok.actorId, itemId: lent }).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    await ctx.ensureItem(sorc, `${SRD}phbsplFireball00`, { system: { method: "atwill" } });
    // Assez d'emplacements de niveau 1 pour rejouer Mains brûlantes, rendus à la fin.
    const { data: sTok } = await ctx.call("get-scene-object", { type: "Token", objectId: sorc.id });
    const slots = (await ctx.call("get-actor", { actorId: sTok.actorId })).system?.spells?.spell1 ?? {};
    await ctx.call("update-actor", { actorId: sTok.actorId, actorData: { "system.spells.spell1.override": 20, "system.spells.spell1.value": 20 } });
    ctx.restore(() => ctx.call("update-actor", { actorId: sTok.actorId, actorData: {
      "system.spells.spell1.override": slots.override ?? null, "system.spells.spell1.value": slots.value ?? 0 } }).catch(() => {}));

    /** Un sort de zone posé sur le Zombi (100 PV) ; rend la résolution, la carte « bouclier » éventuelle et les PV après. */
    const strike = async (identifier) => {
      await ctx.setHp(zombi, 100);
      await pause(400);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: sorc.id, identifier, activityType: "save", area: { shape: "rectangle", ...(await ctx.box(zombi)) },
        usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 90000 }).catch(() => null);
      await pause(1000);
      const shield = (await ctx.messagesSince(since)).map(m => m.flags?.[MODULE_ID]?.areaShield ?? m.flags?.areaShield).find(Boolean) ?? null;
      const target = r?.targets?.find(t => t.name === "Zombi") ?? null;
      return { r, shield, target, hp: await ctx.hp(zombi) };
    };

    // 1. Mains brûlantes (cône) jusqu'à voir les deux issues de la sauvegarde du lanceur.
    const seen = { spared: null, hurt: null };
    for ( let i = 0; (i < 12) && (!seen.spared || !seen.hurt); i++ ) {
      const s = await strike("burning-hands");
      if ( !s.r ) { ctx.log(`essai ${i + 1} : résolution non tranchée`); continue; }
      if ( !s.shield ) { ctx.expect(false, `essai ${i + 1} : la réaction du Zombi part contre le cône (aucune carte « bouclier »)`); break; }
      const key = s.shield.spared ? "spared" : "hurt";
      if ( !seen[key] ) seen[key] = s;
    }
    if ( ctx.expect(!!seen.spared, "l'Ensorceleur rate au moins une sauvegarde (DD 17, 12 essais au plus)") ) {
      const { shield, hp, target } = seen.spared;
      ctx.expect(shield.ifSourceFails === true && shield.save?.success === false, `sauvegarde du lanceur ratée (${shield.save?.total ?? "?"}) : carte « épargné »`);
      ctx.expect(hp === 100, `épargné : PV du Zombi inchangés (100 → ${hp})`);
      ctx.expect(!target?.damage?.applied, `épargné : aucun dégât appliqué par la résolution (${target?.damage?.applied ?? 0})`);
    }
    if ( ctx.expect(!!seen.hurt, "l'Ensorceleur réussit au moins une sauvegarde (12 essais au plus)") ) {
      const { shield, hp, target } = seen.hurt;
      ctx.expect(shield.save?.success === true, `sauvegarde du lanceur réussie (${shield.save?.total ?? "?"}) : carte « les dégâts passent »`);
      ctx.expect((hp < 100) && ((100 - hp) === target?.damage?.applied), `dégâts appliqués : 100 → ${hp} (${target?.damage?.applied ?? "?"})`);
    }

    // 2. Boule de feu (sphère) : la condition « cône ou ligne » ne tient pas, aucune réaction.
    const sphere = await strike("fireball");
    ctx.expect(!!sphere.r, "Boule de feu : résolution tranchée");
    ctx.expect(!sphere.shield, "Boule de feu (sphère) : aucune réaction du Zombi");
    ctx.expect(sphere.hp < 100, `Boule de feu : les dégâts passent (100 → ${sphere.hp})`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
