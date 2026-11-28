/**
 * #33: Cover preview (`api.ui.cover`, badge at the cursor). Read on the GM's side, it must say the same as the verdict computation
 * (`cover`), and in addition: "none" when there is nothing, the source ("creature" for an interposed Fighter), the Cover state set
 * by hand (source "manual", which the verdict leaves to dnd5e). The player-side filter (invisible creatures not counted) is not
 * checked from here: to try with `claude player`.
 */
import { coveringCell } from "./abri.mjs";

export default {
  name: "aperçu de l'abri — sources, état posé à la main, cohérence avec le verdict",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const itemId = await ctx.itemId(sorc.id, "fire-bolt");
    const home = { x: guerrier.x, y: guerrier.y };
    const place = async (x, y) => {
      const moved = await ctx.call("move-token", { tokenId: guerrier.id, x, y });
      if ( !moved?.moved ) throw new Error(`Guerrier non déplacé en ${x},${y}`);
    };
    ctx.restore(() => place(home.x, home.y));
    const preview = () => ctx.engine("coverPreview", { attackerId: sorc.id, targetId: zombi.id, itemId });
    const verdict = () => ctx.engine("cover", { attackerId: sorc.id, targetId: zombi.id, itemId, effective: true });

    // 1. Fighter at his place: the preview = the verdict ("none" when the verdict gives nothing).
    let p = await preview();
    let v = await verdict();
    ctx.log(`à sa place : aperçu ${p?.degree} (${(p?.sources ?? []).join(", ") || "—"}), verdict ${v?.degree ?? "aucun"}`);
    ctx.expect(!!p && (p.degree === (v?.degree ?? "none")), "aperçu et verdict d'accord");
    if ( p?.degree === "none" ) ctx.expect(p.sources.length === 0, "dégagé : aucune source");

    // 2. Fighter interposed: Half Cover by creature.
    const size = await ctx.gridSize();
    const { tokens } = await ctx.scene();
    const cell = coveringCell({ sorc, zombi, guerrier, tokens, size });
    if ( cell ) {
      await place(cell.x, cell.y);
      p = await preview();
      v = await verdict();
      ctx.log(`Guerrier interposé : aperçu ${p?.degree} (${(p?.sources ?? []).join(", ")}), verdict ${v?.degree ?? "aucun"}`);
      ctx.expect(p?.degree === (v?.degree ?? "none"), "interposé : aperçu et verdict d'accord");
      ctx.expect((p?.degree === "half") ? p.sources.includes("creature") : (p?.degree !== "none"), "interposé : la créature est citée comme source");
      await place(home.x, home.y);
    }
    else ctx.log("aucune case libre où le Guerrier couvrirait : étape 2 non applicable");

    // 3. Cover set by hand: returned as is, source "manual" (the verdict leaves it to dnd5e: null).
    await ctx.call("set-status", { tokenId: zombi.id, statusId: "coverThreeQuarters", active: true });
    ctx.restore(() => ctx.call("set-status", { tokenId: zombi.id, statusId: "coverThreeQuarters", active: false }).catch(() => {}));
    await new Promise(r => setTimeout(r, 400));
    p = await preview();
    ctx.expect(p?.manual === true && p.degree === "threeQuarters" && p.bonus === 5 && p.sources[0] === "manual",
      `état posé : abri supérieur +5, posé par le MJ (${JSON.stringify(p)})`);
    ctx.expect(!(await verdict()), "état posé : le verdict n'ajoute rien (dnd5e l'a dans la CA)");
  }
};
