/**
 * Grappling in play (SPEC §15.2, 2024 rules):
 *  1. the Wizard grapples the Zombie (Grapple, replayed until the Zombie fails);
 *  2. the Grappled Zombie attacks the Sorcerer: Disadvantage "Grappled attacker"; attacks the Wizard,
 *     its grappler: not that Disadvantage;
 *  3. the Wizard moves three cells away: the grapple ends by itself (out of reach);
 *  4. the Paladin grapples the Wizard, who tries to Escape until he succeeds: the Grappled condition ends.
 * Puts tokens, conditions, HP and items back.
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "empoignade — désavantage, rupture à distance, s'échapper",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const sorc = await ctx.token("Ensorceleur");
    const paladin = await ctx.token("Paladin");
    const size = await ctx.gridSize();

    const hpBefore = new Map();
    for ( const t of [zombi, sorc, mage] ) {
      const hp = await ctx.hp(t);
      hpBefore.set(t.id, hp);
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const move = async (token, x, y) => {
      const r = await ctx.call("move-token", { tokenId: token.id, x, y });
      if ( !r?.moved && ((r?.after?.x !== x) || (r?.after?.y !== y)) ) throw new Error(`${token.name} non déplacé en ${x},${y}`);
    };
    for ( const t of [mage, paladin, zombi] ) ctx.restore(() => move(t, t.x, t.y));
    for ( const t of [zombi, mage] ) ctx.restore(() => ctx.removeStatusEffects(t, "grappled"));

    /** A token's conditions (token effects, or those of the linked actor). */
    const statusesOf = async token => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      const own = [...(data.delta?.effects ?? [])].flatMap(e => e.statuses ?? []);
      const actor = data.actorLink ? await ctx.call("get-actor", { actorId: data.actorId }) : null;
      return [...own, ...(actor?.effects ?? []).filter(e => !e.disabled).flatMap(e => e.statuses ?? [])];
    };
    const itemsOf = async token => (await ctx.call("get-actor", { actorId: token.actorId })).items ?? [];
    const engineItem = async (token, kind) => (await itemsOf(token)).find(i => i.flags?.[MODULE_ID]?.basicAction === kind);

    await move(mage, zombi.x + size, zombi.y);
    await ctx.startCombat([mage, zombi, paladin]);
    let unarmed = null;
    for ( const until = Date.now() + 6000; !unarmed && (Date.now() < until); await sleep(400) ) unarmed = await engineItem(mage, "unarmed");
    if ( !unarmed ) return ctx.expect(false, "attaque à mains nues posée sur le Magicien");

    /** `who`'s Grapple on `target`, replayed until a failure. true if the target is grappled. */
    // Up to 20 tries: a target within the Paladin's Aura of Protection rarely fails its save.
    async function grapple(who, target) {
      const item = await engineItem(who, "unarmed");
      const totals = [];
      for ( let i = 0; i < 20; i++ ) {
        const used = await ctx.use({ tokenId: who.id, itemId: item._id, activityType: "save", targetTokenIds: [target.id],
          usageConfig: { [MODULE_ID]: { confirmed: true, saveChoice: "best", choice: "dnd5eCombatGrapl" } } });
        const r = await ctx.settle(used.usageMessageId);
        totals.push(r?.targets?.[0]?.save?.total);
        if ( r?.targets?.[0]?.save?.success === false ) {
          ctx.log(`${who.name} → ${target.name} : DD ${r.plan.save.dc}, sauvegardes ${totals.join(", ")}`);
          await sleep(800);
          return (await statusesOf(target)).includes("grappled");
        }
      }
      ctx.log(`${who.name} → ${target.name} : 20 sauvegardes réussies (${totals.join(", ")})`);
      return false;
    }

    // 1. Le Magicien agrippe le Zombi.
    const held = await grapple(mage, zombi);
    ctx.expect(held, "le Magicien agrippe le Zombi");
    if ( !held ) return;

    // 2. Disadvantage of the grappled Zombie against a target other than its grappler.
    const zombiWeapon = (await itemsOf(zombi)).find(i => Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    async function reasonsAgainst(target) {
      const used = await ctx.use({ tokenId: zombi.id, itemId: zombiWeapon._id, activityType: "attack", targetTokenIds: [target.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      const attack = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "attack");
      const mods = attack?.flags?.[MODULE_ID]?.modifiers ?? attack?.flags?.modifiers ?? null;
      return (mods?.disadvantage ?? []).map(r => `${r.who}.${r.key}`);
    }
    // The Wizard has only 7 HP: knocked Unconscious by a Zombie hit, he would release his hold. Temporary Hit Points for the
    // duration of the two attacks.
    await ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.attributes.hp.temp": 50 } });
    ctx.restore(() => ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.attributes.hp.temp": 0 } }).catch(() => {}));
    const vsSorc = await reasonsAgainst(sorc);
    ctx.expect(vsSorc.includes("attacker.grappled"), `Zombi agrippé contre l'Ensorceleur : désavantage (${vsSorc.join(", ") || "aucun"})`);
    const vsMage = await reasonsAgainst(mage);
    ctx.expect(!vsMage.includes("attacker.grappled"), `Zombi agrippé contre le Magicien, son agrippeur : pas ce désavantage (${vsMage.join(", ") || "aucun"})`);
    // The Zombie's hits can knock the Wizard (7 HP) down, Unconscious: he is put back on his feet before he walks.
    const mageHp = hpBefore.get(mage.id);
    await ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.attributes.hp.temp": 0 } });
    await ctx.setHp(mage, mageHp);
    for ( const status of ["unconscious", "prone"] ) await ctx.removeStatusEffects(mage, status);
    await sleep(500);

    // 2 bis. The grappler's mark, and the Zombie dragged when the Wizard WALKS.
    const marksOf = async token => ((await ctx.call("get-actor", { actorId: token.actorId })).effects ?? []).filter(e => e.flags?.[MODULE_ID]?.grappling);
    let marks = [];
    for ( const until = Date.now() + 4000; !marks.length && (Date.now() < until); await sleep(300) ) marks = await marksOf(mage);
    ctx.expect(marks.length === 1, `marque sur l'agrippeur : « ${marks[0]?.name ?? "absente"} »`);
    const posOf = async token => (await ctx.call("get-scene-object", { type: "Token", objectId: token.id })).data;
    const before = await posOf(zombi);
    const mageAt = await posOf(mage);
    // An ordinary move (walk), not a teleport: `move-token` with the "walk" action. An update
    // of x (`update-scene-object`) makes the V14 core fail on Restored Keep ("setting 'last'", empty traveled segment
    // in `createTerrainMovementPath`, canvas/placeables/token.mjs:3831 — seen on 2026-09-25).
    // Toward the south: to the east, the Bandit may occupy the second cell (seen on 2026-09-25).
    await ctx.call("move-token", { tokenId: mage.id, x: mageAt.x, y: mageAt.y + (2 * size), action: "walk" });
    let after = before;
    for ( const until = Date.now() + 5000; (after.x === before.x) && (after.y === before.y) && (Date.now() < until); await sleep(300) ) after = await posOf(zombi);
    const mageNow = await posOf(mage);
    ctx.expect(mageNow.y === mageAt.y + (2 * size), `le Magicien marche de deux cases (${mageAt.y} → ${mageNow.y})`);
    // At its relative place if it is free, otherwise on a free cell in contact (SPEC §15.2, `dragDestination`):
    // the scene may have a creature in the way — we only require that it moved and is in contact.
    const gap = Math.max(Math.abs(after.x - mageNow.x), Math.abs(after.y - mageNow.y)) / size;
    ctx.expect(((after.x !== before.x) || (after.y !== before.y)) && (gap === 1),
      `le Zombi agrippé suit, au contact du Magicien (${before.x},${before.y} → ${after.x},${after.y})`);
    await sleep(800);
    ctx.expect((await statusesOf(zombi)).includes("grappled"), "toujours agrippé après avoir été traîné");

    // 3. The Wizard teleports 20 ft away: no drag, the grapple ends, the mark falls.
    await move(mage, after.x + (4 * size), after.y);
    let still = true;
    for ( const until = Date.now() + 5000; still && (Date.now() < until); await sleep(400) ) still = (await statusesOf(zombi)).includes("grappled");
    ctx.expect(!still, "le Magicien téléporté à 20 ft : le Zombi n'est plus agrippé (hors de portée)");
    for ( const until = Date.now() + 3000; marks.length && (Date.now() < until); await sleep(300) ) marks = await marksOf(mage);
    ctx.expect(!marks.length, "la marque de l'agrippeur est retirée avec l'empoignade");
    await move(zombi, zombi.x, zombi.y);

    // 4. The Paladin grapples the Wizard, who escapes.
    const magePos = await posOf(mage);
    await move(paladin, magePos.x + size, magePos.y);   // in contact with the Wizard, to the east
    const caught = await grapple(paladin, mage);
    ctx.expect(caught, "le Paladin agrippe le Magicien");
    if ( !caught ) return;
    const escape = await engineItem(mage, "escape");
    ctx.expect(!!escape, `S'échapper posé sur le Magicien (${escape?.name ?? "absent"})`);
    if ( !escape ) return;
    let free = false;
    let tries = 0;
    // Each try: we wait for the check ("check" message) before judging — the 3D dice of a visible window
    // take 2 to 3 s, and a try relaunched too early overlapped the previous one.
    for ( ; (tries < 12) && !free; tries++ ) {
      const used = await ctx.use({ tokenId: mage.id, itemId: escape._id, activityType: "utility" });
      for ( const until = Date.now() + 6000; Date.now() < until; await sleep(300) ) {
        if ( (await ctx.messagesSince(used.usageMessageId)).some(m => m.type === "check") ) break;
      }
      await sleep(500);
      free = !(await statusesOf(mage)).includes("grappled");
    }
    ctx.expect(free, `le Magicien s'échappe (${tries} essai(s))`);
  }
};
