import { logError, logInfo } from '../util/logger';

/**
 * Re-type kanka-sourced actors to the wh40k-rpg `<system>-<kind>` shape.
 *
 * Actors created by earlier versions of this plugin landed with bare types
 * like `'character'` and `'npc'`, which don't match any wh40k-rpg
 * DataModel and so render as the "broken empty default" sheet. This
 * migration walks every actor flagged with `kanka-foundry.kankaEntityId`
 * and rewrites the type to `<defaultGameSystem>-<kind>`. The default
 * game system is read from the kanka-foundry setting (configurable per
 * world to support BC / DH1 / DH2 / DW / OW / RT / IM).
 *
 * Also sets `prototypeToken.displayName = 30` (HOVER for any user) so
 * nameplates appear under tokens on hover — Foundry's default is NONE.
 */

const VALID_SYSTEMS = ['bc', 'dh1', 'dh2', 'dw', 'ow', 'rt', 'im'];
const VALID_KINDS = ['character', 'npc', 'vehicle'];
const TOKEN_DISPLAY_HOVER = 30;

function isAlreadyPrefixed(type: string): boolean {
    if (!type.includes('-')) return false;
    const [systemId, kind] = type.split('-');
    return VALID_SYSTEMS.includes(systemId) && VALID_KINDS.includes(kind);
}

export default async function migrate(): Promise<void> {
    const actors = Array.from(game.actors?.values() ?? []).filter(
        (a: Actor) => a.getFlag('kanka-foundry', 'kankaEntityId'),
    );
    if (actors.length === 0) return;

    const gameSystem = (game.settings?.get('kanka-foundry', 'defaultGameSystem') as string) ?? 'dh2';

    let touched = 0;
    let failed = 0;
    for (const actor of actors) {
        const type = actor.type as string;
        const proto = (actor as unknown as { prototypeToken?: { displayName?: number } }).prototypeToken;
        const currentDisplayName = proto?.displayName;

        const updates: Record<string, unknown> = {};

        if (!isAlreadyPrefixed(type)) {
            const kind = VALID_KINDS.includes(type) ? type : 'npc';
            updates.type = `${gameSystem}-${kind}`;
        }
        if (currentDisplayName !== TOKEN_DISPLAY_HOVER) {
            updates['prototypeToken.displayName'] = TOKEN_DISPLAY_HOVER;
        }

        if (Object.keys(updates).length === 0) continue;

        try {
            await actor.update(updates);
            logInfo(`kanka-foundry migration: ${actor.name} ${JSON.stringify(updates)}`);
            touched++;
        } catch (error) {
            logError(`kanka-foundry migration failed for ${actor.name}`, error);
            failed++;
        }
    }
    logInfo(`kanka-foundry migration 2026-05-11: touched=${touched} failed=${failed}`);
}
