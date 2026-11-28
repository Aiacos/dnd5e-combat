/**
 * Hide (SPEC §15.2, 2024 rules), the Wizard in combat with the Zombi:
 *  1. Hide until the DC 15 Stealth check succeeds: a "hidden" effect is placed, which carries the DC to locate the Wizard
 *     (its total), without the core's Invisible condition (§185): the Zombi (enemy) no longer sees the Wizard,
 *     the Fighter (ally) does;
 *  2. a Dagger attack: Hide ends after the roll;
 *  3. hidden again, Ray of Frost (verbal component): it ends too.
 * The conditions (out of sight of every enemy) go through legality: this scenario confirms them automatically;
 * they are checked separately (enemiesSeeing). Restores HP, effects and items.
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "furtivité — caché (DD, invisible pour les ennemis seuls), fin à l'attaque et au sort verbal",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    for ( const t of [zombi, mage] ) {
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const hiddenEffects = async () => ((await ctx.call("get-actor", { actorId: mage.actorId })).effects ?? [])
      .filter(e => e.flags?.[MODULE_ID]?.hidden);
    ctx.restore(async () => {
      for ( const e of await hiddenEffects() ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: mage.actorId, effectId: e._id });
    });
    const engineItem = async kind => ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? [])
      .find(i => i.flags?.[MODULE_ID]?.basicAction === kind);

    await ctx.startCombat([mage, zombi]);
    let hide = null;
    for ( const until = Date.now() + 6000; !hide && (Date.now() < until); await sleep(400) ) hide = await engineItem("hide");
    ctx.expect(!!hide, `Furtivité posée sur le Magicien (${hide?.name ?? "absente"})`);
    if ( !hide ) return;

    /** Hide until it succeeds (20 tries at most: Stealth +2 against DC 15, 40% success). */
    async function hideUntilHidden() {
      for ( let i = 0; i < 20; i++ ) {
        const used = await ctx.use({ tokenId: mage.id, itemId: hide._id, activityType: "utility" });
        for ( const until = Date.now() + 6000; Date.now() < until; await sleep(300) ) {
          if ( (await ctx.messagesSince(used.usageMessageId)).some(m => m.type === "check") ) break;
        }
        // §252: the verdict waits for the 3D dice to finish (capped at 8 s) — we wait for the effect until then;
        // a failure places none.
        for ( const until = Date.now() + 9000; Date.now() < until; await sleep(300) ) {
          const effects = await hiddenEffects();
          if ( effects.length ) return effects[0];
        }
      }
      return null;
    }

    // 1. Hidden.
    const hidden = await hideUntilHidden();
    // §185: the effect no longer carries the core's Invisible condition; the engine makes the token invisible to its enemies only.
    ctx.expect(!!hidden && !(hidden.statuses ?? []).includes("invisible"),
      `caché : effet « ${hidden?.name ?? "absent"} », DD ${hidden?.flags?.[MODULE_ID]?.hidden?.dc ?? "?"}, sans l'état Invisible du cœur`);
    if ( hidden ) {
      ctx.expect((await ctx.engine("sees", { observerId: zombi.id, targetId: mage.id })).sees === false, "le Zombi (ennemi) ne le voit plus");
      const ally = await ctx.token("Guerrier").catch(() => null);
      if ( ally ) ctx.expect((await ctx.engine("sees", { observerId: ally.id, targetId: mage.id })).sees === true, "le Guerrier (allié) le voit toujours");
    }
    ctx.expect((hidden?.flags?.[MODULE_ID]?.hidden?.dc ?? 0) >= 15, "le DD pour le localiser est le total du test (≥ 15)");
    if ( !hidden ) return;

    // 2. Attack: end of Hide.
    const stab = await ctx.use({ tokenId: mage.id, identifier: "dagger", activityType: "attack", targetTokenIds: [zombi.id] });
    await ctx.settle(stab.usageMessageId).catch(() => null);
    let left = [hidden];
    for ( const until = Date.now() + 5000; left.length && (Date.now() < until); await sleep(400) ) left = await hiddenEffects();
    ctx.expect(!left.length, "après le jet d'attaque, le Magicien n'est plus caché");

    // 3. Spell with a verbal component: end of Hide.
    const again = await hideUntilHidden();
    ctx.expect(!!again, "de nouveau caché");
    if ( !again ) return;
    const ray = await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [zombi.id], rollAttack: false });
    await sleep(1500);
    left = await hiddenEffects();
    ctx.expect(!left.length, `après Rayon de givre (composante verbale), plus caché (${ray.used ? "sort lancé" : "sort non lancé"})`);
  }
};
