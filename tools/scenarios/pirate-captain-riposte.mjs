/**
 * PR #268 — Pirate Captain's Riposte (Monster Manual 2024 / SRD 5.2): "The pirate adds 3 to its AC against that attack, possibly
 * causing it to miss." The item's "+3 AC" effect lasts a round in its data; the entry `mm-pirate-captain-riposte` holds it for the
 * triggering attack only (`forOneAttack`, as the Shield-like Parry of §19.6).
 * The Fighter strikes a Pirate Captain in melee until the Riposte is taken (reaction taken at once, `autoReact: "first"`):
 *  1. the resolution names the reaction, and the attack was judged against AC + 3;
 *  2. once the attack is resolved, no effect of the Riposte stays on the Captain;
 *  3. a second attack right after (nobody reacts, `autoReact: "none"`) is judged against the base AC.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pirate-captain-riposte — +3 AC against the triggering attack only (PR #268)",

  async run(ctx) {
    await ctx.cast({ "Capitaine pirate": "mmPirateCaptain0" }, { near: "Guerrier" });
    const { tokens } = await ctx.scene();
    if ( !["Capitaine pirate", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Pirate Captain or Fighter missing: not applicable"); return; }
    const pirate = await ctx.token("Capitaine pirate");
    const fighter = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const home = await ctx.position(pirate);
    const hp = await ctx.hp(pirate);
    ctx.restore(() => ctx.setHp(pirate, hp));
    ctx.restore(() => ctx.call("move-token", { tokenId: pirate.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    const at = await ctx.position(fighter);
    await ctx.call("move-token", { tokenId: pirate.id, x: at.x + grid, y: at.y, elevation: at.elevation });
    await pause(800);

    const riposteEffects = async () => (await ctx.effectsFrom(pirate, "riposte", "mm-pirate-captain-riposte")).filter(e => !e.disabled);
    // The base AC is the one an attack without reaction is judged against (the unlinked token's synthetic actor is not readable
    // through `get-actor`, bench of 2026-11-25).
    let baseAc = null;
    const items = (await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? [];
    const weapon = items.find(i => (i.type === "weapon") && (i.system?.equipped !== false)
      && Object.values(i.system?.activities ?? {}).some(a => (a.type === "attack") && (a.attack?.type?.value === "melee")));
    if ( !ctx.expect(!!weapon, `the Fighter has a melee weapon (${weapon?.name})`) ) return;

    // Out of combat, as `parade-relance` (§489): the Fighter may strike again and again without its action economy refusing.
    const strike = async auto => {
      await ctx.setHp(pirate, hp);
      const used = await ctx.use({ tokenId: fighter.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [pirate.id],
        usageConfig: { [MODULE_ID]: { autoReact: auto } } });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2000);
      return r?.targets?.find(t => t.token?.endsWith(pirate.id) || (t.name === "Capitaine pirate")) ?? null;
    };

    // 1. Strike until the Riposte is taken. It is only offered when +3 can turn the hit into a miss (a total of 17 to 19): about one try
    // in seven, so 30 tries were not always enough (bench of 2026-11-25).
    let reacted = null;
    for ( let i = 0; (i < 50) && !reacted; i++ ) {
      const t = await strike("first");
      if ( t?.reaction ) reacted = t;
      else if ( Number.isFinite(t?.ac) ) baseAc ??= t.ac;
    }
    // Monster Manual 2024: AC 17 — used if every try opened the Riposte.
    baseAc ??= 17;
    ctx.log(`Pirate Captain's base AC: ${baseAc}`);
    if ( !ctx.expect(!!reacted, "the Fighter hits the Captain and the Riposte is taken (50 tries at most)") ) return;
    ctx.expect(/riposte/i.test(String(reacted.reaction)), `reaction named in the resolution (${reacted.reaction})`);
    ctx.expect(reacted.ac === baseAc + 3, `the attack is judged against AC ${baseAc} + 3 (${reacted.ac})`);
    const line = (await ctx.engineLog()).filter(l => /only applied to this attack|ne valait que pour cette attaque/.test(l)).at(-1);
    ctx.log(line ? `log: ${line.replace(/^.*\| /, "")}` : "no removal line in the log");

    // 2. Once resolved: no Riposte effect left on the Captain.
    await pause(1000);
    const left = await riposteEffects();
    ctx.expect(!left.length, `no Riposte effect left on the Captain (${left.map(e => e.effect).join(", ") || "none"})`);

    // 3. A second attack right after, nobody reacts: the base AC.
    const second = await strike("none");
    if ( ctx.expect(!!second, "the second attack is resolved") ) {
      ctx.expect(!second.reaction, `no reaction on the second attack (${second.reaction ?? "none"})`);
      ctx.expect(second.ac === baseAc, `the next attack is judged against AC ${baseAc} (${second.ac})`);
    }
  }
};
