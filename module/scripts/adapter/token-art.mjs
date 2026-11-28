/**
 * Still image of a token for an `<img>` tag (2026-11-13): a token texture can be a video (JB2A `.webm` placed by
 * DAS · Animations on a summon, or by a GM), which an `<img>` shows broken. For a video: its thumbnail if the core has already
 * computed it (`game.video.thumbs`, client/helpers/media/video-helper.mjs:190), otherwise the actor's image, otherwise the
 * default icon. Same test as the core (`VideoHelper.hasVideoExtension`, video-helper.mjs:100).
 * @param {TokenDocument|Token} token
 * @param {string|null} [fallback]   image to prefer over the actor's
 * @returns {string}
 */
export function tokenArt(token, fallback = null) {
  const doc = token?.document ?? token;
  const src = doc?.texture?.src ?? "";
  const video = foundry.helpers.media.VideoHelper;
  if ( !video.hasVideoExtension(src) ) return src || fallback || doc?.actor?.img || "";
  const still = [game.video?.thumbs?.get(src), fallback, doc?.actor?.img].find(s => s && !video.hasVideoExtension(s));
  return still ?? CONST.DEFAULT_TOKEN;
}
