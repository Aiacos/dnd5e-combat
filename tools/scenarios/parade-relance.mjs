/**
 * §489 : la relance forcée d'un jet d'attaque (étape `reroll`, Parade d'un monstre). Un item synthétique prêté au Magicien, sa règle
 * posée dans la surcouche du monde (`api.mcp.overrideContent`) :
 *   { on: "isHit", if: { "hit.critical": false }, do: [{ type: "use" }, { type: "reroll" }] }
 *   { on: "isMissed", free: true, if: { "attack.rerolled": true, "attack.fumble": true }, do: [{ type: "use", activity: <riposte>, target: "source", free: true }] }
 * Le Zombi frappe le Magicien au contact jusqu'à le toucher (réaction prise d'office, `autoReact: "first"`) :
 *  1. une carte « relance » (`flags["dnd5e-combat"].forcedReroll`) au nom du Zombi, après le jet d'origine, l'ancien total noté ;
 *  2. la résolution note le jet relancé sur la cible (`rerolled`) et la rejuge avec lui : touché si et seulement si le nouveau total
 *     atteint la CA (hors critique / échec critique), réaction « Parade » ;
 *  3. un premier jet critique n'ouvre pas la fenêtre (pas de carte) ; un 1 naturel au nouveau jet fait partir la riposte (carte
 *     d'utilisation de l'activité « Riposte » du Magicien) — vérifiés seulement si les dés les donnent.
 * Remet PV, position, item prêté et surcouche.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const IDENTIFIER = "essai-parade-relance-das";
const PARRY = "essaiParadeRel01";
const RIPOSTE = "essaiParadeRip01";
const RULE = { triggers: [
  { on: "isHit", if: { "hit.critical": false }, do: [{ type: "use", activity: PARRY }, { type: "reroll" }] },
  { on: "isMissed", free: true, if: { "attack.rerolled": true, "attack.fumble": true },
    do: [{ type: "use", activity: RIPOSTE, target: "source", free: true }] }] };

export default {
  name: "parade-relance — Parade d'un monstre : l'attaquant relance son jet, le coup est rejugé (§489)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Magicien", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Magicien et Zombi requis : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const mageHp = await ctx.hp(mage);
    const grid = await ctx.gridSize();
    const zHome = await ctx.position(zombi);
    const magePos = await ctx.position(mage);
    ctx.restore(() => ctx.setHp(mage, mageHp));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: zHome.x, y: zHome.y, elevation: zHome.elevation }).catch(() => {}));

    // --- Item et règle prêtés ----------------------------------------------------------------------------------------
    const activity = (id, name) => ({ _id: id, type: "utility", name, activation: { type: "reaction", value: 1 },
      target: { affects: { type: "self" } } });
    const itemData = { name: "Essai : parade", type: "feat", img: "icons/svg/shield.svg",
      system: { identifier: IDENTIFIER, activities: { [PARRY]: activity(PARRY, "Parade"), [RIPOSTE]: activity(RIPOSTE, "Riposte") } } };
    await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(mage.id, IDENTIFIER);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: mage.actorId, itemId: lent }).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));

    // Le Zombi au contact du Magicien (à gauche).
    await ctx.call("move-token", { tokenId: zombi.id, x: magePos.x - grid, y: magePos.y, elevation: zHome.elevation });
    await pause(800);
    const items = (await ctx.call("get-actor", { actorId: zombi.actorId })).items ?? [];
    const weapon = items.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!weapon, `le Zombi a une attaque au corps à corps (${weapon?.name})`) ) return;

    // --- Le Zombi frappe jusqu'à une Parade (20 essais au plus) ---------------------------------------------------------
    let parried = null;
    let critSeen = false;
    let fumbleSeen = false;
    for ( let i = 0; (i < 20) && !(parried && (fumbleSeen || (i >= 8))); i++ ) {
      await ctx.setHp(mage, mageHp);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: zombi.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [mage.id],
        usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2500);
      const messages = await ctx.messagesSince(since);
      const card = messages.find(m => m.flags?.[MODULE_ID]?.forcedReroll);
      const target = r?.targets?.find(t => t.name === "Magicien");
      if ( !target ) continue;
      // 3a. Un premier jet critique : « sans effet si la première attaque était un coup critique » — la fenêtre ne s'ouvre pas.
      if ( target.critical && !target.rerolled ) {
        critSeen = true;
        ctx.expect(!card, "premier jet critique : pas de relance");
        continue;
      }
      if ( !card ) continue;   // raté d'emblée : pas de fenêtre
      const flag = card.flags[MODULE_ID].forcedReroll;
      parried ??= { r, target, flag };
      // 3b. Un 1 naturel au nouveau jet : la riposte gratuite part (carte d'utilisation de l'activité « Riposte »).
      if ( flag.fumble ) {
        fumbleSeen = true;
        const riposte = messages.find(m => (m.type === "usage") && String(m.system?.activity?.uuid ?? m.flags?.dnd5e?.activity?.uuid ?? "").endsWith(RIPOSTE));
        ctx.expect(!!riposte, `nouveau jet à 1 naturel : la riposte part (${riposte ? "carte présente" : "absente"})`);
      }
    }
    if ( !ctx.expect(!!parried, "le Zombi touche le Magicien et la Parade force une relance (20 essais au plus)") ) return;

    // --- 1 et 2. La carte, puis le rejugement -------------------------------------------------------------------------
    const { r, target, flag } = parried;
    ctx.expect(flag.from === r.attack?.roll?.total, `la carte note l'ancien total (${flag.from} ; jet d'origine ${r.attack?.roll?.total})`);
    ctx.expect(target.rerolled?.total === flag.total, `la résolution porte le jet relancé (${target.rerolled?.total} ; carte ${flag.total})`);
    ctx.expect(target.reaction === "Essai : parade" || /Parade/.test(String(target.reaction)), `réaction notée (${target.reaction})`);
    const expected = target.rerolled.isFumble ? false : (target.rerolled.isCritical ? true : (target.rerolled.total >= target.ac));
    ctx.expect(target.hit === expected, `coup rejugé avec le nouveau jet : ${target.rerolled.total} contre CA ${target.ac} → ${target.hit ? "touché" : "raté"}`);
    if ( !critSeen ) ctx.log("aucun premier jet critique dans ces essais : l'exclusion « coup critique » n'a pas été jouée (tests unitaires)");
    if ( !fumbleSeen ) ctx.log("aucun 1 naturel au nouveau jet : la riposte n'a pas été jouée (tests unitaires)");
  }
};
