/**
 * §383 (issue #38): a multi-form summon cast as from the action bar (without dnd5e's window) opens the engine's "Choose the form"
 * window, and the chosen form is the one that dnd5e summons — not the first by default.
 *  1. Summon Celestial: Defender (the second profile; before the fix, Avenger was taken without asking).
 *  2. Summon Elemental: Fire (the third of four).
 * The Wizard gets the Player's Handbook spells for the length of the test; nothing is consumed; the placed creatures are removed.
 */
const SPELLS = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// `index`: the chosen form, by its position (the names follow the language of the GM's client: Defender / Défenseur with
// the PHB-fr). `fx`: a piece of the name of the appearance animation expected when BLFX and darsh-animations are active
// (Celestial: the entry that darsh-animations adds, BLFX has none; Elemental: BLFX's).
const CASES = [
  { item: "phbsplSummonCele", index: 1, label: "Défenseur", fx: "holy_light2" },
  { item: "phbsplSummonElem", index: 2, label: "Feu", fx: null },
  // From the sheet, by the GM, without a level 5 slot (Kaalisti, Warlock 5, in the table feedback): "No more charge"
  // (§77) → "Cast anyway", whose replay skipped dnd5e's window — Avenger by default.
  { item: "phbsplSummonCele", index: 1, label: "Défenseur (fiche, sans emplacement)", fx: null, sheet: true }
];

export default {
  name: "invocations — la forme se choisit quand la barre saute la fenêtre de dnd5e (Céleste, Élémentaire)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const grid = await ctx.gridSize();
    const pos = await ctx.position(mage);
    const summoned = [];
    // dnd5e creates a world actor for the summoned creature when it does not already have one (`Actor5e.fetchExisting`): the test's
    // ones go to the connector's trash.
    const actorsBefore = new Set((await ctx.call("list-actors", {})).map(a => a.id));
    const actorsMade = new Set();
    ctx.restore(async () => {
      for ( const id of actorsMade ) if ( !actorsBefore.has(id) ) await ctx.call("trash-document", { documentType: "Actor", documentId: id }).catch(() => {});
      const live = (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.map(t => t.id);
      for ( const id of summoned ) if ( live.includes(id) ) await ctx.call("delete-scene-object", { type: "Token", objectId: id }).catch(() => {});
      for ( const d of (await ctx.call("list-dialogs", { dialogsOnly: true })).windows ?? [] ) {
        if ( /Summon|Convocation/.test(d.title ?? "") ) await ctx.call("answer-dialog", { id: d.id, close: true }).catch(() => {});
      }
    });

    // The Summon Celestial animation comes from darsh-animations ≥ the version that publishes `previewSummon` (its SPEC §22).
    const summonFx = !!(await ctx.call("call-module-api", { moduleId: "darsh-animations", fn: "previewSummon", args: {} }).catch(() => null));
    const slots6 = Number((await ctx.call("get-actor", { actorId: mage.actorId })).system?.spells?.spell6?.value) > 0;
    const slots5 = Number((await ctx.call("get-actor", { actorId: mage.actorId })).system?.spells?.spell5?.value) > 0;
    const animated = !!(await ctx.call("call-module-api", { moduleId: "darsh-animations", fn: "renderer", args: {} }).catch(() => null))
      && ((await ctx.engine("sequencer", {})).available);
    for ( const [n, { item: source, index, label, fx, sheet=false }] of CASES.entries() ) {
      const itemId = await ctx.ensureItem(mage, SPELLS + source);
      if ( sheet && slots5 ) { ctx.log(`${source} : le Magicien a des emplacements de niveau 5, cas « sans emplacement » sauté`); continue; }
      const started = await ctx.engine("castFromBar", { tokenId: mage.id, itemId, sheet, x: pos.x + ((n + 1) * grid), y: pos.y + grid });
      if ( sheet ) {
        const asked = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 8000 });
        const forced = (asked.windows ?? []).find(d => (d.buttons ?? []).some(b => ["yes", "go"].includes(b.action)) && !(d.fields ?? []).some(f => f.name === "profile"));
        if ( !ctx.expect(!!forced, `${source} : le MJ peut lancer sans emplacement (« Plus de charge »)`) ) continue;
        await ctx.call("answer-dialog", { id: forced.id, button: (forced.buttons ?? []).some(b => b.action === "go") ? "go" : "yes" });
      }
      const wanted = started.profiles[index];
      if ( !ctx.expect(!!wanted, `${source} : la forme ${label} existe (${started.profiles.map(p => p.name).join(" / ")})`) ) continue;
      let dialog = null;
      for ( let i = 0; !dialog && (i < 8); i++ ) {
        const found = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 });
        dialog = (found.windows ?? []).find(d => (d.fields ?? []).some(f => f.name === "profile"));
        if ( !dialog ) await pause(500);
      }
      if ( !ctx.expect(!!dialog, `${source} : la fenêtre « Choisir la forme » s'ouvre (${sheet ? "relance sans emplacement" : "barre"}, sans la fenêtre de dnd5e)`) ) continue;
      await ctx.call("answer-dialog", { id: dialog.id, fields: { profile: wanted.id }, button: "summon" });
      let captured = null;
      for ( let i = 0; i < 20; i++ ) {
        await pause(500);
        captured = await ctx.engine("summonCaptured", {});
        if ( captured?.tokens ) break;
      }
      ctx.expect(captured?.summoned?.profile === wanted.id, `${source} : dnd5e invoque la forme choisie, ${wanted.name} (${captured?.summoned?.name ?? "rien"})`);
      const placed = captured?.tokens ?? [];
      summoned.push(...placed.map(t => t.id));
      for ( const t of placed ) if ( t.actorId ) actorsMade.add(t.actorId);
      ctx.expect(placed.length > 0, `${source} : la créature est posée (${placed.map(t => t.name).join(", ") || "aucune"})`);
      // The appearance (darsh-animations, BLFX "After Summon"): Sequencer effects running shortly after placement.
      let files = [];
      for ( let i = 0; animated && !(fx && !summonFx) && (i < 10); i++ ) {
        await pause(400);
        files = (await ctx.engine("sequencer", {})).effects.map(e => e.file);
        if ( files.length && (!fx || files.some(f => f.includes(fx))) ) break;
      }
      if ( fx && !summonFx ) ctx.log(`${source} : darsh-animations sans les animations d'invocation (§22) : apparition non vérifiée`);
      else if ( animated ) ctx.expect(files.length > 0 && (!fx || files.some(f => f.includes(fx))),
        `${source} : une animation d'apparition joue (${files.map(f => f.split("/").pop()).slice(0, 3).join(", ") || "aucune"})`);
      await pause(2500);
    }

    // §385: Create Undead — with no body to target, the window asks how many ghouls (1 to 3 at level 6); 1 chosen.
    // Without a level 6 slot, the GM then goes through "No more charge" (the spell goes at its own level, §384).
    const undead = await ctx.ensureItem(mage, SPELLS + "phbsplCreateUnde");
    await ctx.engine("castFromBar", { tokenId: mage.id, itemId: undead, sheet: true, x: pos.x + (4 * grid), y: pos.y + grid });
    let form = null;
    for ( let i = 0; !form && (i < 8); i++ ) {
      const found = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 });
      form = (found.windows ?? []).find(d => (d.fields ?? []).some(f => f.name === "count"));
      if ( !form ) await pause(500);
    }
    const countField = form?.fields?.find(f => f.name === "count");
    if ( ctx.expect(!!form, "Création de morts-vivants : la fenêtre demande le nombre, sans cible à désigner") ) {
      ctx.expect((countField.options ?? []).map(o => o.value).join(",") === "1,2,3", `de 1 à 3 goules au niveau 6 (${(countField.options ?? []).map(o => o.value).join(",")})`);
      await ctx.call("answer-dialog", { id: form.id, fields: { count: "1" }, button: "summon" });
      if ( !slots6 ) {
        const asked = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 6000 });
        const forced = (asked.windows ?? []).find(d => (d.buttons ?? []).some(b => ["yes", "go"].includes(b.action)));
        if ( forced ) await ctx.call("answer-dialog", { id: forced.id, button: (forced.buttons ?? []).some(b => b.action === "go") ? "go" : "yes" });
      }
      let captured = null;
      for ( let i = 0; i < 20; i++ ) {
        await pause(500);
        captured = await ctx.engine("summonCaptured", {});
        if ( captured?.tokens ) break;
      }
      const placed = captured?.tokens ?? [];
      summoned.push(...placed.map(t => t.id));
      for ( const t of placed ) if ( t.actorId ) actorsMade.add(t.actorId);
      ctx.expect(captured?.summoned?.count === 1, `dnd5e pose le nombre choisi : ${captured?.summoned?.count ?? "rien"} (niveau ${captured?.summoned?.level ?? "?"})`);
      ctx.expect(placed.length === 1, `une seule goule posée (${placed.length})`);
      ctx.expect(captured?.summoned?.level === 6, `au niveau du sort, 6 (${captured?.summoned?.level})`);
      // §386: the Monster Manual 2024 ghoul (otherwise the SRD 2024 one), not the SRD 2014 one that the spell's data designate.
      const mm = (await ctx.call("list-compendiums", {})).some(p => p.id === "dnd-monster-manual.actors");
      const wanted = mm ? "Compendium.dnd-monster-manual.actors." : "Compendium.dnd5e.actors24.";
      ctx.expect(String(captured?.summoned?.uuid ?? "").startsWith(wanted), `goule du ${mm ? "Monster Manual 2024" : "SRD 2024"} (${captured?.summoned?.uuid})`);
    }

    // §387: Animate Dead — with no bones or corpse to target, Skeleton or Zombie, and how many: at level 4, "level × 2 − 5" = 3.
    // As from the bar with a level 4 slot (nothing is consumed); Zombie, 2 chosen.
    const dead = await ctx.ensureItem(mage, SPELLS + "phbsplAnimateDea");
    const started = await ctx.engine("castFromBar", { tokenId: mage.id, itemId: dead, slot: "spell4", x: pos.x + grid, y: pos.y + (3 * grid) });
    const zombie = started.profiles.find(p => /zomb/i.test(p.name)) ?? started.profiles[1];
    let deadForm = null;
    for ( let i = 0; !deadForm && (i < 8); i++ ) {
      const found = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 });
      deadForm = (found.windows ?? []).find(d => (d.fields ?? []).some(f => f.name === "count"));
      if ( !deadForm ) await pause(500);
    }
    const deadCount = deadForm?.fields?.find(f => f.name === "count");
    if ( ctx.expect(!!deadForm, "Animation des morts : la fenêtre demande la forme et le nombre, sans cible à désigner") ) {
      ctx.expect((deadCount.options ?? []).map(o => o.value).join(",") === "1,2,3", `de 1 à 3 au niveau 4 (${(deadCount.options ?? []).map(o => o.value).join(",")})`);
      await ctx.call("answer-dialog", { id: deadForm.id, fields: { profile: zombie.id, count: "2" }, button: "summon" });
      let captured = null;
      for ( let i = 0; i < 20; i++ ) {
        await pause(500);
        captured = await ctx.engine("summonCaptured", {});
        if ( captured?.tokens ) break;
      }
      const placed = captured?.tokens ?? [];
      summoned.push(...placed.map(t => t.id));
      for ( const t of placed ) if ( t.actorId ) actorsMade.add(t.actorId);
      ctx.expect(captured?.summoned?.profile === zombie.id, `Zombi invoqué (${captured?.summoned?.name ?? "rien"})`);
      ctx.expect(placed.length === 2, `deux zombis posés (${placed.length})`);
    }
  }
};
