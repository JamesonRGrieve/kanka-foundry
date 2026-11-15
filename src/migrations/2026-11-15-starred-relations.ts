/**
 * Re-run the snapshot trim (wh40k-rpg#739) now that an overview page keeps only its
 * starred relations. Worlds trimmed by 2026-11-14 still hold each character's whole
 * relation list on the overview page as well as on the relations page; the trim is
 * idempotent, so running it again cuts just that.
 */
export { default } from './2026-11-14-trim-snapshots';
