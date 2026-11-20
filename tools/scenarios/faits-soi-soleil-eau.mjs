/**
 * §484 : faits sur la créature elle-même — `self.inSunlight`, `self.inRunningWater` — et un trait qui blesse son porteur au début de son
 * tour (`to: "self"`, sans effet posé). Arène de test (en plein jour). Deux traits d'essai prêtés au Guerrier :
 *  - « Brûle au soleil » : 20 radiants au début de son tour au soleil, Désavantage aux tests de caractéristique au soleil ;
 *  - « Craint l'eau courante » : 5 dégâts de froid au début de son tour dans une région marquée « eau courante ».
 * Au soleil et dans l'eau : test avec Désavantage, puis 25 dégâts au début de son tour. Dans une région d'obscurité, hors de l'eau : test
 * sans Désavantage, plus aucun dégât au tour suivant.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "faits de la créature elle-même §484 — soleil, eau courante, dégâts d'un trait au début du tour",

  async run(ctx) {
    const { tokens, sceneId } = await ctx.scene();
    if ( !["Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Bandit absent : non applicable"); return; }
    const grid = await ctx.gridSize();
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    for ( const t of [fighter, bandit] ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }).catch(() => {}));
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
    }
    for ( const itemData of [SUN, WATER] ) {
      const r = await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData, match: { path: "system.identifier", value: itemData.system.identifier } });
      const itemId = r.itemId ?? r.id ?? r.item?._id ?? (await ctx.itemId(fighter.id, itemData.system.identifier));
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: fighter.actorId, itemId }).catch(() => {}));
    }
    await pause(800);

    // 1. Au soleil : Désavantage au test (un jet « kl »).
    const light = (await ctx.engine("stealth", { tokenId: fighter.id }))?.light;
    if ( light !== 2 ) ctx.log(`lumière au départ : ${light} (l'arène n'est pas en plein jour ?)`);
    const sunny = await ctx.engine("rollCheck", { tokenId: fighter.id, skill: "ath" });
    ctx.expect(/kl/.test(sunny?.formula ?? ""), `au soleil : test d'Athlétisme avec Désavantage (« ${sunny?.formula} »)`);
    const save = await ctx.engine("rollSave", { tokenId: fighter.id, ability: "dex" });
    ctx.expect(!/kl/.test(save?.formula ?? ""), `au soleil : la sauvegarde, elle, sans Désavantage (« ${save?.formula} »)`);

    // 2. Une région « eau courante » sous le Guerrier.
    const p = await ctx.position(fighter);
    const water = await ctx.call("create-region", { sceneId, name: "Eau courante (essai)", color: "#3a7bd5",
      shapes: [{ type: "rectangle", x: p.x - grid, y: p.y - grid, width: grid * 3, height: grid * 3 }], behaviors: [] });
    const waterId = water?.id ?? water?.regionId ?? water?.region?.id;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: waterId }).catch(() => {}));
    await ctx.call("update-scene-object", { type: "Region", objectId: waterId, data: { "flags.dnd5e-combat.runningWater": true } });
    await pause(800);

    // 3. Combat : Bandit d'abord, puis le Guerrier — au début de son tour, 20 radiants et 5 de froid.
    await ctx.startCombat([bandit, fighter]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [token, value] of [[bandit, 20], [fighter, 10]] ) {
      const c = combat.combatants.find(x => x.tokenId === token.id);
      await ctx.call("set-initiative", { combatantId: c.id, value, combatId: ctx.ownCombat });
    }
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    for ( let i = 0; (i < 3) && ((await current()) !== bandit.id); i++ ) { await ctx.nextTurn(); await pause(800); }
    if ( !ctx.expect((await current()) === bandit.id, "tour du Bandit") ) return;
    await ctx.setHp(fighter, 60);
    const selfCards = async since => (await ctx.messagesSince(since)).filter(m => m.flags?.["dnd5e-combat"]?.selfDamage);
    let mark = await ctx.lastMessageId();
    await ctx.nextTurn();
    await pause(3000);
    let cards = await selfCards(mark);
    const items = cards.map(m => m.flags["dnd5e-combat"].selfDamage.item);
    ctx.expect(items.includes("das-test-burns-in-sunlight"), `début du tour du Guerrier au soleil : une carte de dégâts radiants (${items.join(", ") || "aucune"})`);
    ctx.expect(items.includes("das-test-fears-running-water"), "dans l'eau courante : une carte de dégâts de froid");
    await pause(800);
    const hp = await ctx.hp(fighter);
    ctx.expect(hp <= 35, `PV du Guerrier : ${hp} (60 − 20 − 5, résistances non comprises)`);

    // 4. À l'ombre et hors de l'eau : plus de Désavantage, plus de dégâts.
    const dark = await ctx.call("create-region", { sceneId, name: "Obscurité (essai)", color: "#000000",
      shapes: [{ type: "rectangle", x: p.x + grid * 3, y: p.y - grid, width: grid * 3, height: grid * 3 }],
      behaviors: [{ type: "adjustDarknessLevel", name: "Obscurité", system: { mode: 0, modifier: 1 } }] });
    const darkId = dark?.id ?? dark?.regionId ?? dark?.region?.id;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: darkId }).catch(() => {}));
    await ctx.call("move-token", { tokenId: fighter.id, x: p.x + grid * 4, y: p.y, elevation: p.elevation });
    await pause(1500);
    ctx.log(`lumière à l'ombre : ${(await ctx.engine("stealth", { tokenId: fighter.id }))?.light}`);
    const shaded = await ctx.engine("rollCheck", { tokenId: fighter.id, skill: "ath" });
    ctx.expect(!/kl/.test(shaded?.formula ?? ""), `à l'ombre : test sans Désavantage (« ${shaded?.formula} »)`);
    await ctx.setHp(fighter, 60);
    mark = await ctx.lastMessageId();
    for ( let i = 0; i < 2; i++ ) { await ctx.nextTurn(); await pause(2000); }
    ctx.expect((await current()) === fighter.id, "de nouveau le tour du Guerrier");
    cards = await selfCards(mark);
    ctx.expect(!cards.length, `à l'ombre, hors de l'eau : aucun dégât de ses traits (${cards.length} carte(s))`);
    ctx.expect((await ctx.hp(fighter)) === 60, `PV du Guerrier inchangés (${await ctx.hp(fighter)})`);
  }
};

/* Les traits d'essai (déclarés après le scénario : son titre est le premier `name`). */
const SUN = {
  name: "Brûle au soleil (essai)", type: "feat", img: "icons/magic/light/explosion-star-glow-orange.webp",
  system: { identifier: "das-test-burns-in-sunlight", type: { value: "monster" }, description: { value: "<p>Essai §484.</p>" } },
  flags: { "dnd5e-combat": {
    triggers: [{ on: "startOfTurn", if: { "self.inSunlight": true }, do: [{ type: "damage", to: "self", formula: "20", damageType: "radiant" }] }],
    rollDisadvantage: { on: ["check"], if: { "self.inSunlight": true } }
  } }
};
const WATER = {
  name: "Craint l'eau courante (essai)", type: "feat", img: "icons/magic/water/wave-water-blue.webp",
  system: { identifier: "das-test-fears-running-water", type: { value: "monster" }, description: { value: "<p>Essai §484.</p>" } },
  flags: { "dnd5e-combat": {
    triggers: [{ on: "startOfTurn", if: { "self.inRunningWater": true }, do: [{ type: "damage", to: "self", formula: "5", damageType: "cold" }] }]
  } }
};
