/**
 * An item's attacks that ignore Cover (`attackIgnoresCover: true | "half"`, DF #245 of 2026-11-23, §521; request
 * darsh-homebrew#10, Fire Burst spell). Test arena: the Fighter interposed between the Sorcerer and the Zombie gives Half
 * Cover (cell chosen by the engine's rule, `coveringCell` of abri.mjs). The Cover that remains for the Fire Bolt attack
 * (`cover`, `effective`):
 *  1. without a rule: half;
 *  2. `attackIgnoresCover: true` on `fire-bolt` (world overlay): nothing left;
 *  3. `"half"`: nothing left either against Half Cover;
 *  4. rule removed: Half Cover again.
 * Restored: the Fighter's position, the overlay.
 */
import { coveringCell } from "./abri.mjs";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "abri ignoré par les attaques d'un item — attackIgnoresCover (#245)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Ensorceleur", "Zombi", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Ensorceleur, Zombi ou Guerrier absent : non applicable"); return; }
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const itemId = await ctx.itemId(sorc.id, "fire-bolt");
    if ( !ctx.expect(!!itemId, "l'Ensorceleur a Trait de feu") ) return;
    const home = { x: guerrier.x, y: guerrier.y };
    ctx.restore(() => ctx.call("move-token", { tokenId: guerrier.id, x: home.x, y: home.y }).catch(() => {}));
    const cell = coveringCell({ sorc, zombi, guerrier, tokens, size: await ctx.gridSize() });
    if ( !cell ) { ctx.log("aucune case libre où le Guerrier couvrirait : non applicable"); return; }
    await ctx.call("move-token", { tokenId: guerrier.id, x: cell.x, y: cell.y });
    await pause(800);
    const left = async () => (await ctx.engine("cover", { attackerId: sorc.id, targetId: zombi.id, itemId, effective: true }))?.degree ?? "none";

    const raw = await left();
    if ( !ctx.expect(raw === "half", `sans règle : abri partiel contre Trait de feu (${raw})`) ) return;
    const { before } = await ctx.engine("overrideContent", { identifier: "fire-bolt", entry: { attackIgnoresCover: true } });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: "fire-bolt", entry: before }).catch(() => {}));
    // A world overlay already placed on Fire Bolt: kept, the key added on top.
    if ( before ) await ctx.engine("overrideContent", { identifier: "fire-bolt", entry: { ...before, attackIgnoresCover: true } });
    await pause(300);
    const ignored = await left();
    ctx.expect(ignored === "none", `attackIgnoresCover: true — l'abri partiel ne compte plus (${ignored})`);
    await ctx.engine("overrideContent", { identifier: "fire-bolt", entry: { ...(before ?? {}), attackIgnoresCover: "half" } });
    await pause(300);
    const half = await left();
    ctx.expect(half === "none", `attackIgnoresCover: "half" — l'abri partiel ne compte plus non plus (${half})`);
    await ctx.engine("overrideContent", { identifier: "fire-bolt", entry: before });
    await pause(300);
    const back = await left();
    ctx.expect(back === "half", `règle retirée : de nouveau partiel (${back})`);
  }
};
