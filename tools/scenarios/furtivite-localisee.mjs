/**
 * Issue #107 — a sense that locates without sight (Tremorsense) pinpoints a Hidden creature's square; the creature stays unseen and
 * keeps its Hidden state. In the « Arène de la vision » (`node tools/arene-vision.mjs` first).
 *  1. The Target in the dark (lit by default) gets the engine's Hide effect (DC 20).
 *  2. Rules: Vibrations (Tremorsense 60 ft) does not see it but knows its square (`pinpoints`); the Human and Blindsight (a sight)
 *     neither see it nor know its square. Screen: Vibrations shows it with the Tremorsense outline, the Human shows nothing.
 *  3. Fire Bolt from Vibrations: no « Hidden: you do not know where it is » refusal. Fire Bolt from the Human: refused.
 *  4. After both, the Target is still Hidden (nothing revealed it).
 */
const FIRE_BOLT = "Compendium.dnd-players-handbook.spells.Item.phbsplFireBolt00";
const HIDDEN_NAME = "Furtivité (scénario furtivité localisée)";
const REFUSAL = /cach|hidden/i;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "furtivité localisée — vibrations : case connue d'une créature cachée, non vue, toujours cachée (#107)",
  scene: "Arène de la vision",

  async run(ctx) {
    const { sceneId } = await ctx.scene();
    const vib = await ctx.token("Vibrations");
    const human = await ctx.token("Humain");
    const blind = await ctx.token("Vision aveugle");
    const target = await ctx.token("Cible dans le noir");

    // 1. Hidden (the engine's Hide effect: Invisible + DC).
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: target.id });
    const owner = tok.actorLink ? { documentType: "Actor", id: tok.actorId } : { uuid: `Scene.${sceneId}.Token.${target.id}.Actor.${tok.actorId}` };
    ctx.restore(() => ctx.removeEffectsNamed(target, /scénario furtivité localisée/));
    await ctx.call("upsert-embedded-effect", { ...owner, effectData: {
      name: HIDDEN_NAME, img: "icons/svg/cowled.svg", transfer: false, disabled: false, statuses: ["invisible"], changes: [],
      flags: { "dnd5e-combat": { hidden: { dc: 20 } } } } });
    await pause(1500);
    const stillHidden = async () => (await ctx.effects(target)).some(e => e.name === HIDDEN_NAME);
    if ( !ctx.expect(await stillHidden(), "la Cible dans le noir est cachée (effet de Furtivité, DD 20)") ) return;

    // 2. Rules and screen.
    const rows = (await ctx.engine("visionMatrix", { observerIds: [vib.id, human.id, blind.id], targetIds: [target.id] })).rows;
    const row = name => rows.find(r => r.observer === name);
    for ( const r of rows ) ctx.log(`  ${r.observer} → ${r.target} : voit ${r.rules.sees}, localise ${r.rules.locates}, case connue ${r.rules.pinpoints} (${r.rules.distance} ft) ; écran ${r.screen}`);
    const v = row("Vibrations"), h = row("Humain"), b = row("Vision aveugle");
    ctx.expect(v.rules.sees === false, "Vibrations ne voit pas la créature cachée (attaques au Désavantage)");
    ctx.expect(v.rules.pinpoints === true, "Vibrations connaît sa case (perception des vibrations)");
    ctx.expect(v.rules.locates === false, "la discrétion ne change pas : `canLocate` reste faux (Se cacher, Chercher, Perception passive)");
    ctx.expect(v.screen === "outline", `Vibrations : à l'écran, contour de la perception des vibrations (écran : ${v.screen})`);
    ctx.expect(h.rules.sees === false && h.rules.pinpoints === false, "l'Humain ne la voit pas et ne sait pas où elle est");
    ctx.expect(h.screen === "hidden", `l'Humain : rien à l'écran (écran : ${h.screen})`);
    ctx.expect(b.rules.sees === false && b.rules.pinpoints === false, "la vision aveugle est une vue : elle ne trouve pas une créature cachée");

    // 3. Legality: Fire Bolt on the Hidden target.
    const bolt = async (token, label) => {
      await ctx.ensureItem(token, FIRE_BOLT, { system: { method: "atwill" } });
      const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      ctx.call("use-activity", { tokenId: token.id, itemId: await ctx.itemId(token.id, "fire-bolt"), activityType: "attack",
        targetTokenIds: [target.id], configure: false, usageConfig: { "dnd5e-combat": { autoReact: "none" } } }).catch(() => null);
      const windows = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 6000 }).catch(() => null))?.windows ?? [];
      const refused = windows.find(w => REFUSAL.test(w.text ?? ""));
      for ( const w of windows ) await ctx.call("answer-dialog", { id: w.id, button: "cancel" }).catch(() => {});
      ctx.log(`  ${label} : ${windows.length ? windows.map(w => `« ${(w.text ?? "").slice(0, 120)} »`).join(" ; ") : "aucune fenêtre"}`);
      return refused;
    };
    ctx.expect(!(await bolt(vib, "Vibrations")), "Trait de feu de Vibrations sur la créature cachée : pas de refus « caché »");
    await pause(2000);
    ctx.expect(!!(await bolt(human, "Humain")), "Trait de feu de l'Humain sur la créature cachée : refusé (« caché : vous ne savez pas où il est »)");
    await pause(1500);

    // 4. Still Hidden.
    ctx.expect(await stillHidden(), "après les deux tirs, la Cible est toujours cachée");
  }
};
