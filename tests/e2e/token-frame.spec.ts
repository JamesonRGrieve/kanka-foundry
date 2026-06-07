import { expect, test } from '@playwright/test';
import { joinAndEnableKanka } from './lib/foundry';

/**
 * Tier B: the wh40k-rpg token regime end to end. syncTokenImage on a
 * wh40k-rpg world must write the PLAIN PORTRAIT as the token texture, clear
 * the legacy ring.subject.texture mirror, and stamp
 * prototypeToken.flags.wh40k-rpg.tokenFrame — the system's runtime circular
 * mask then GPU-generates the bust at draw time. No pre-framed Kanka
 * token.png asset is requested at all on this path (the legacy probe is
 * skipped), so the spec needs no Kanka server.
 *
 * The final check renders a placed token on a real scene and screenshots it
 * (screenshots/token-frame.png): a circular bust inside the ring band,
 * generated live from a rectangular system portrait.
 */

const PORTRAIT = 'systems/wh40k-rpg/images/bestiary/dh2/death-jester.webp';

interface SyncResult {
    error: string | null;
    textureSrc?: string;
    subjectTexture?: string | null | undefined;
    tokenFrame?: object | undefined;
    sceneId?: string;
    actorId?: string;
}

test.describe('token frame regime (wh40k-rpg)', () => {
    test.setTimeout(180_000);
    test('syncTokenImage writes portrait + tokenFrame; runtime mask renders the bust', async ({ page }) => {
        const active = await joinAndEnableKanka(page);
        expect(active).toBe(true);

        const state = await page.evaluate(async (portrait: string): Promise<SyncResult> => {
            const g = globalThis as unknown as {
                game: {
                    paused: boolean;
                    togglePause(p: boolean): void;
                    modules: { get(id: string): { api?: { syncTokenImage?: (a: object, c: number, e: number, f: boolean) => Promise<void> } } | undefined };
                };
                Actor: {
                    create(d: object): Promise<{
                        id: string;
                        img: string | null;
                        prototypeToken: { texture: { src: string }; ring: { subject: { texture: string | null } }; flags: Record<string, Record<string, object> | undefined> };
                        getTokenDocument(d: object): Promise<{ toObject(): object }>;
                        update(d: object): Promise<object>;
                    }>;
                };
                Scene: {
                    create(d: object): Promise<{
                        id: string;
                        view(): Promise<void>;
                        createEmbeddedDocuments(t: string, d: object[]): Promise<object[]>;
                    }>;
                };
                canvas: {
                    ready: boolean;
                    animatePan(o: { x: number; y: number; scale: number; duration: number }): Promise<void>;
                    tokens?: { placeables: Array<{ mesh: { texture: { width: number; height: number } } | null }> };
                };
            };
            try {
                const sync = g.game.modules.get('kanka-foundry')?.api?.syncTokenImage;
                if (sync === undefined) return { error: 'api.syncTokenImage not exposed' };
                const actor = await g.Actor.create({ name: 'token-frame e2e', type: 'dh2-npc', img: portrait });
                // the actor-create flow may sync img defaults; force the portrait
                await actor.update({ img: portrait });
                await sync(actor, 4711, 990002, true);

                const proto = actor.prototypeToken;
                const result: SyncResult = {
                    error: null,
                    textureSrc: proto.texture.src,
                    subjectTexture: proto.ring.subject.texture,
                    tokenFrame: proto.flags['wh40k-rpg']?.['tokenFrame'],
                    actorId: actor.id,
                };

                const scene = await g.Scene.create({ name: 'token-frame e2e', width: 800, height: 800 });
                result.sceneId = scene.id;
                const td = await actor.getTokenDocument({ x: 300, y: 300 });
                await scene.createEmbeddedDocuments('Token', [td.toObject()]);
                await scene.view();
                await new Promise((resolve) => {
                    setTimeout(resolve, 5000);
                });
                if (g.game.paused) g.game.togglePause(false);
                await g.canvas.animatePan({ x: 350, y: 350, scale: 3, duration: 0 });
                await new Promise((resolve) => {
                    setTimeout(resolve, 2000);
                });
                const mesh = g.canvas.tokens?.placeables[0]?.mesh;
                if (mesh === null || mesh === undefined) return { ...result, error: 'no token mesh after scene view' };
                if (!(mesh.texture.width === 512 && mesh.texture.height === 512)) {
                    return { ...result, error: `mesh texture is ${mesh.texture.width}x${mesh.texture.height}, expected the 512x512 runtime bust` };
                }
                return result;
            } catch (err) {
                return { error: err instanceof Error ? err.message : String(err) };
            }
        }, PORTRAIT);

        if (state.error === null) {
            const vp = page.viewportSize() ?? { width: 1280, height: 720 };
            await page.screenshot({
                path: 'tests/e2e/screenshots/token-frame.png',
                clip: { x: vp.width / 2 - 300, y: vp.height / 2 - 300, width: 600, height: 600 },
            });
        }

        // cleanup before assertions so failures don't leak documents
        await page.evaluate(async (ids: { sceneId?: string; actorId?: string }) => {
            const g = globalThis as unknown as {
                game: {
                    scenes: { get(id: string): { delete(): Promise<void> } | undefined };
                    actors: { get(id: string): { delete(): Promise<void> } | undefined };
                };
            };
            if (ids.sceneId !== undefined) await g.game.scenes.get(ids.sceneId)?.delete();
            if (ids.actorId !== undefined) await g.game.actors.get(ids.actorId)?.delete();
        }, state);

        expect(state.error).toBeNull();
        expect(state.textureSrc).toBe(PORTRAIT);
        expect(state.subjectTexture ?? null).toBeNull();
        expect(state.tokenFrame).toBeDefined();
    });
});
