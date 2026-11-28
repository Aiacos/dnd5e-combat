/**
 * §414: Arcane Ward (B14, §16.11; Projected Ward §38; Warding Bond §156) under realistic play conditions, on the
 * "Arène de l'abjuration" (`node tools/arene-abjuration.mjs`): a level 6 Abjurer Wizard (Int 18, 40 HP), an allied Fighter
 * (60 HP) at 10 ft, an Ogre (club 2d8 + 4) that hits both. For the ward, replaces the shared tokens of the Test Arena
 * (`reduction`), whose state left by other scenarios skewed the result (2026-11-12). Checks, in order:
 *  1. Creation: the "create the ward" activity gives a pool of 2 × level + Int mod. = 16, full.
 *  2. Absorption: an Ogre hit on the Abjurer — the pool takes what it can, HP the rest; "absorbs" card.
 *  3. Recharge: an abjuration spell cast with a slot restores 2 × its level (Mage Armor at level 1: +2, at level 2: +4),
 *     the slot is spent; a cantrip (Ray of Frost) recharges nothing.
 *  4. Warding Bond, full ward: the Ogre hits the protected creature (Bond Resistance: half); the Abjurer takes the same
 *     amount, which his ward absorbs (it is damage he takes) — his HP do not move.
 *  5. Warding Bond, empty ward: the same shared damage lowers the Abjurer's HP.
 *     With BLFX active (§156): its sharing trigger is disarmed on the effect, and it does not share a second time.
 *  6. Projected Ward (Reaction): the Ogre hits the protected creature, the Abjurer's ward absorbs in its place; empty, the
 *     protected creature takes the rest.
 * Everything is restored: HP, pool, slots, effects (the runner adds its safety net).
 */
const MODULE_ID = "dnd5e-combat";
const CREATE = "Hha69hPMTYWhDE4A";
const pause = ms => new Promise(r => setTimeout(r, ms));
const sum = rolls => (rolls ?? []).reduce((s, r) => s + (r.total ?? 0), 0);

export default {
  name: "égide de l'abjurateur — création, absorption, recharge, Lien protecteur, Égide projetée",
  scene: "Arène de l'abjuration",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Abjurateur", "Protégé", "Ogre"].every(n => tokens.some(t => t.name === n)) ) {
      ctx.log("Abjurateur, Protégé ou Ogre absent (node tools/arene-abjuration.mjs) : non applicable");
      return;
    }
    const abj = await ctx.token("Abjurateur");
    const prot = await ctx.token("Protégé");
    const ogre = await ctx.token("Ogre");
    const id = {};
    for ( const k of ["arcane-ward", "projected-ward", "warding-bond", "mage-armor", "ray-of-frost"] ) id[k] = await ctx.itemId(abj.id, k).catch(() => null);
    if ( !ctx.expect(!!id["arcane-ward"] && !!id["warding-bond"] && !!id["mage-armor"], "l'Abjurateur a l'Égide arcanique, le Lien protecteur et l'Armure du mage") ) return;
    const ogreItems = (await ctx.call("get-actor", { actorId: ogre.actorId })).items ?? [];
    const club = ogreItems.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!club, `l'Ogre a une arme (${club?.name})`) ) return;

    /** The prepared state, read on the GM's side: HP, ward pool (max computed by dnd5e), creation, slots, effects. */
    const live = async () => (await ctx.call("run-script", { waitMs: 8000, args: { abj: abj.id, prot: prot.id, ward: id["arcane-ward"] }, code: `
      const A = canvas.tokens.get(args.abj).actor, P = canvas.tokens.get(args.prot).actor, w = A.items.get(args.ward);
      const hp = a => ({ value: a.system.attributes.hp.value, temp: a.system.attributes.hp.temp || 0, max: a.system.attributes.hp.max });
      return { abj: hp(A), prot: hp(P), ward: { max: Number(w.system.uses.max) || 0, value: Number(w.system.uses.value) || 0, spent: Number(w.system.uses.spent) || 0,
          created: (w.system.activities.get("${CREATE}")?.uses?.spent ?? 0) > 0 },
        level: A.items.find(i => i.type === "class")?.system.levels, intMod: A.system.abilities.int.mod,
        slots: { 1: A.system.spells.spell1.value, 2: A.system.spells.spell2.value },
        effects: { abj: A.effects.map(e => e.name), prot: P.effects.map(e => e.name) } };` })).result;
    /** Restores HP and pool (spent, created). */
    const set = async ({ abjHp, protHp, spent, created } = {}) => ctx.call("run-script", { waitMs: 8000,
      args: { abj: abj.id, prot: prot.id, ward: id["arcane-ward"], abjHp, protHp, spent, created }, code: `
      const A = canvas.tokens.get(args.abj).actor, P = canvas.tokens.get(args.prot).actor, w = A.items.get(args.ward);
      if ( args.abjHp != null ) await A.update({ "system.attributes.hp.value": args.abjHp, "system.attributes.hp.temp": 0 });
      if ( args.protHp != null ) await P.update({ "system.attributes.hp.value": args.protHp, "system.attributes.hp.temp": 0 });
      const upd = {};
      if ( args.spent != null ) upd["system.uses.spent"] = args.spent;
      if ( args.created != null ) upd["system.activities.${CREATE}.uses.spent"] = args.created ? 1 : 0;
      if ( Object.keys(upd).length ) await w.update(upd);
      return true;` });

    const s0 = await live();
    ctx.log(`départ : niveau ${s0.level}, Int ${s0.intMod >= 0 ? "+" : ""}${s0.intMod}, Abjurateur ${s0.abj.value}/${s0.abj.max}, Protégé ${s0.prot.value}/${s0.prot.max}, emplacements ${JSON.stringify(s0.slots)}`);
    const effects0 = { abj: new Set(s0.effects.abj), prot: new Set(s0.effects.prot) };
    ctx.restore(() => set({ abjHp: s0.abj.max, protHp: s0.prot.max, spent: 0, created: false }));
    ctx.restore(async () => {
      for ( const [t, key] of [[abj, "abj"], [prot, "prot"]] ) {
        const fresh = (await ctx.effects(t)).filter(e => !effects0[key].has(e.name) && !e.flags?.[MODULE_ID]?.aura);
        for ( const e of fresh ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
    });
    ctx.restore(() => ctx.call("run-script", { args: { abj: abj.id, slots: s0.slots }, code: `
      const A = canvas.tokens.get(args.abj).actor;
      await A.update({ "system.spells.spell1.value": args.slots[1], "system.spells.spell2.value": args.slots[2] }); return true;` }));

    /** The Ogre attacks `target` (full HP) until it hits. `react`: "none" (nobody reacts) or "first" (Projected Ward). */
    const strike = async (target, react = "none") => {
      for ( let i = 0; i < 20; i++ ) {
        await set({ abjHp: s0.abj.max, protHp: s0.prot.max });
        const before = await live();
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: ogre.id, itemId: club._id, activityType: "attack", targetTokenIds: [target.id],
          usageConfig: { [MODULE_ID]: { autoReact: react } } });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( !r?.targets?.find(t => t.name === target.name)?.hit ) continue;
        await pause(2500);
        const msgs = await ctx.messagesSince(since);
        return { before, after: await live(), dealt: sum(msgs.find(m => m.type === "damage")?.rolls), msgs };
      }
      return null;
    };

    // 1. Ward creation.
    await set({ abjHp: s0.abj.max, protHp: s0.prot.max, spent: 0, created: false });
    await ctx.use({ tokenId: abj.id, itemId: id["arcane-ward"], activityId: CREATE, consume: true });
    await pause(1500);
    const s1 = await live();
    const expected = 2 * (s1.level ?? 0) + (s1.intMod ?? 0);
    ctx.expect(s1.ward.created, "« créer l'égide » utilisé (une fois par repos long)");
    ctx.expect(s1.ward.max === expected, `réserve de l'égide = 2 × niveau ${s1.level} + Int ${s1.intMod} = ${expected} (lu : ${s1.ward.max})`);
    ctx.expect(s1.ward.value === s1.ward.max, `égide pleine à la création (${s1.ward.value}/${s1.ward.max})`);

    // 2. Absorption sur l'Abjurateur.
    await set({ spent: 0 });
    const hit = await strike(abj);
    if ( ctx.expect(!!hit, "l'Ogre touche l'Abjurateur (20 essais au plus)") ) {
      const absorbed = hit.after.ward.spent - hit.before.ward.spent;
      const lost = hit.before.abj.value - hit.after.abj.value;
      const want = Math.min(hit.before.ward.value, hit.dealt);
      ctx.expect(absorbed === want, `l'égide absorbe ${absorbed} (jet ${hit.dealt}, réserve ${hit.before.ward.value} : attendu ${want})`);
      ctx.expect(lost === Math.min(hit.before.abj.value, hit.dealt - want), `l'Abjurateur ne perd que le reste : ${lost} PV`);
      ctx.expect(hit.msgs.some(m => m.flags?.[MODULE_ID]?.absorbed || /absorb/i.test(`${m.content ?? ""} ${m.text ?? ""}`)), "une carte dit ce que l'égide a absorbé");
    }

    // 2 bis (§474). The remainder beyond the ward, independent of the Ogre's die (6 to 20: it exceeds 16 only one time in six):
    // ward at 5, 9 bludgeoning damage — the ward takes 5, the Abjurer loses 4. With DDB Importer active, the ward was rebuilt and
    // those 4 HP restored.
    {
      await set({ abjHp: s0.abj.max, spent: s1.ward.max - 5 });
      const b = await live();
      await ctx.call("run-script", { waitMs: 8000, args: { abj: abj.id }, code: `
        await canvas.tokens.get(args.abj).actor.applyDamage([{ value: 9, type: "bludgeoning" }], { isDelta: true }); return true;` });
      await pause(1500);
      const a = await live();
      ctx.expect(b.ward.value === 5 && a.ward.value === 0, `reste : l'égide (5) prend 5 (${b.ward.value} → ${a.ward.value})`);
      ctx.expect(b.abj.value - a.abj.value === 4, `reste : 9 dégâts, l'Abjurateur perd les 4 qui passent l'égide (${b.abj.value} → ${a.abj.value})`);
    }

    // 3. Recharge by an abjuration spell cast with a slot.
    const recharge = async (level, label) => {
      await set({ spent: 10 });
      const b = await live();
      await ctx.use({ tokenId: abj.id, itemId: id["mage-armor"], activityType: "utility", targetTokenIds: [abj.id], consume: true,
        usageConfig: { spell: { slot: `spell${level}` } } });
      await pause(2000);
      const a = await live();
      ctx.expect(a.ward.spent === b.ward.spent - 2 * level, `${label} : l'égide regagne ${2 * level} (dépensé ${b.ward.spent} → ${a.ward.spent})`);
      ctx.expect(a.slots[level] === b.slots[level] - 1, `${label} : un emplacement de niveau ${level} dépensé (${b.slots[level]} → ${a.slots[level]})`);
    };
    await recharge(1, "Armure du mage au niveau 1");
    await recharge(2, "Armure du mage au niveau 2");
    // A cantrip (Ray of Frost on the Ogre: one attack, no window) recharges nothing.
    if ( id["ray-of-frost"] ) {
      await set({ spent: 10 });
      const u = await ctx.use({ tokenId: abj.id, itemId: id["ray-of-frost"], activityType: "attack", targetTokenIds: [ogre.id],
        usageConfig: { [MODULE_ID]: { autoReact: "none" } } });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      ctx.expect((await live()).ward.spent === 10, "un tour de magie (Rayon de givre) ne recharge rien");
    }

    // 4. Warding Bond, full ward: the ward takes the shared damage.
    await set({ spent: 0 });
    await ctx.use({ tokenId: abj.id, itemId: id["warding-bond"], activityType: "utility", targetTokenIds: [prot.id], consume: true,
      usageConfig: { spell: { slot: "spell2" } } });
    await pause(2000);
    const bonded = await live();
    ctx.expect(bonded.effects.prot.some(n => /Warding Bond|Bonded|Lien protecteur|Lié/i.test(n)), `le Protégé porte le Lien protecteur (${bonded.effects.prot.join(", ")})`);
    // §156: an animation module (BLFX) also shares the Bond's damage; the engine disarms its trigger when the effect is applied.
    const foreign = (await ctx.call("run-script", { waitMs: 8000, args: { prot: prot.id }, code: `
      const id = "boss-loot-assets-premium", P = canvas.tokens.get(args.prot).actor;
      const marks = P.effects.map(e => e.flags?.[id]?.blfxCustom?.trigger).filter(t => t != null);
      return { active: !!game.modules.get(id)?.active, marks };` })).result ?? { active: false, marks: [] };
    if ( !foreign.active ) ctx.log("BLFX inactif dans ce monde : son désarmement (§156) n'est pas vérifié ici");
    else if ( ctx.expect(foreign.marks.length > 0, `BLFX actif : il a marqué l'effet du Lien (${foreign.marks.join(", ") || "aucune marque"})`) ) {
      ctx.expect(foreign.marks.every(t => t === `${MODULE_ID}:applyDamage`), `BLFX actif : son partage est désarmé (${foreign.marks.join(", ")})`);
    }
    const shared = async label => {
      const h = await strike(prot);
      if ( !ctx.expect(!!h, `${label} : l'Ogre touche le Protégé (20 essais au plus)`) ) return null;
      const lostProt = h.before.prot.value - h.after.prot.value;
      const absorbed = h.after.ward.spent - h.before.ward.spent;
      const lostAbj = h.before.abj.value - h.after.abj.value;
      ctx.log(`${label} : jet ${h.dealt}, Protégé −${lostProt}, égide −${absorbed} (réserve ${h.before.ward.value}), Abjurateur −${lostAbj}`);
      ctx.expect(lostProt === Math.floor(h.dealt / 2), `${label} : Résistance du Lien, le Protégé perd la moitié (${lostProt} pour ${h.dealt})`);
      ctx.expect(h.msgs.some(m => m.flags?.[MODULE_ID]?.shared), `${label} : le partage est annoncé`);
      ctx.expect(!h.msgs.some(m => /same fate/i.test(`${m.flavor ?? ""} ${m.content ?? ""}`)), `${label} : aucun second partage par un autre module (« same fate »)`);
      return { h, lostProt, absorbed, lostAbj };
    };
    const full = await shared("égide pleine");
    if ( full ) {
      const want = Math.min(full.h.before.ward.value, full.lostProt);
      ctx.expect(full.absorbed === want, `égide pleine : elle absorbe les ${full.lostProt} partagés (${full.absorbed})`);
      ctx.expect(full.lostAbj === full.lostProt - want, `égide pleine : l'Abjurateur perd ${full.lostAbj} PV (attendu ${full.lostProt - want})`);
    }

    // 5. Warding Bond, empty ward: the Abjurer takes the shared damage.
    await set({ spent: s1.ward.max });
    const empty = await shared("égide vide");
    if ( empty ) {
      ctx.expect(empty.absorbed === 0, `égide vide : rien d'absorbé (${empty.absorbed})`);
      ctx.expect(empty.lostAbj === empty.lostProt && empty.lostAbj > 0, `égide vide : l'Abjurateur perd autant que le Protégé (${empty.lostAbj} = ${empty.lostProt})`);
    }
    // The Bond removed before Projected Ward (otherwise the two mix).
    for ( const e of (await ctx.effects(prot)).filter(e => /Warding Bond|Bonded|Lien protecteur|Lié/i.test(e.name ?? "")) ) {
      await ctx.call("remove-embedded-effect", { documentType: "Actor", id: prot.actorId, effectId: e._id ?? e.id }).catch(() => {});
    }
    for ( const e of (await ctx.effects(abj)).filter(e => /Warding Bond|Bonded|Lien protecteur|Lié|Concentr/i.test(e.name ?? "")) ) {
      await ctx.call("remove-embedded-effect", { documentType: "Actor", id: abj.actorId, effectId: e._id ?? e.id }).catch(() => {});
    }
    await pause(1000);

    // 6. Projected Ward: as a Reaction, the Abjurer's ward takes the protected creature's damage.
    if ( id["projected-ward"] ) {
      await set({ spent: 0 });
      const p = await strike(prot, "first");
      if ( ctx.expect(!!p, "Égide projetée : l'Ogre touche le Protégé (20 essais au plus)") ) {
        const absorbed = p.after.ward.spent - p.before.ward.spent;
        const lostProt = p.before.prot.value - p.after.prot.value;
        ctx.expect(absorbed === Math.min(p.before.ward.value, p.dealt), `Égide projetée : l'égide absorbe ${absorbed} (jet ${p.dealt})`);
        ctx.expect(lostProt + absorbed === p.dealt, `Égide projetée : Protégé −${lostProt} + égide −${absorbed} = ${p.dealt}`);
        ctx.expect(p.after.abj.value === p.before.abj.value, "Égide projetée : les PV de l'Abjurateur ne bougent pas");
      }
    }
  }
};
