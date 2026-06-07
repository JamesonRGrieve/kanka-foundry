import { describe, expect, it, vi } from 'vitest';
import { buildTokenPatch } from './tokenImage';

vi.mock('../api');

describe('buildTokenPatch (wh40k-rpg runtime mask)', () => {
    const base = {
        systemId: 'wh40k-rpg',
        actorType: 'dh2-npc',
        portrait: 'https://kanka.example/portrait.png',
        kankaTokenUrl: 'https://kanka.example/c/1/e/2/token.png',
        hasTokenFrame: false,
        ringDefaults: {},
    };

    it('uses the plain portrait, clears the subject mirror, writes the tokenFrame flag', () => {
        const patch = buildTokenPatch(base);
        expect(patch).toMatchObject({
            'prototypeToken.texture.src': 'https://kanka.example/portrait.png',
            'prototypeToken.ring.enabled': true,
            'prototypeToken.ring.subject.texture': null,
            'prototypeToken.flags.wh40k-rpg.tokenFrame': {},
        });
        // the pre-framed Kanka token asset must NOT appear anywhere
        expect(JSON.stringify(patch)).not.toContain('token.png');
    });

    it('preserves an existing tokenFrame (GM-tuned centre coordinates)', () => {
        const patch = buildTokenPatch({ ...base, hasTokenFrame: true });
        expect(patch).not.toHaveProperty(['prototypeToken.flags.wh40k-rpg.tokenFrame']);
    });

    it('drops mirrored ring.subject.scale defaults (animation-path-only field)', () => {
        const patch = buildTokenPatch({
            ...base,
            ringDefaults: { 'prototypeToken.ring.colors.ring': '#ff0000', 'prototypeToken.ring.subject.scale': 0.8 },
        });
        expect(patch).toMatchObject({ 'prototypeToken.ring.colors.ring': '#ff0000' });
        expect(patch).not.toHaveProperty(['prototypeToken.ring.subject.scale']);
    });

    it('hides NPC nameplates but leaves PCs alone', () => {
        expect(buildTokenPatch(base)).toMatchObject({ 'prototypeToken.displayName': 0 });
        expect(buildTokenPatch({ ...base, actorType: 'dh2-character' })).not.toHaveProperty(['prototypeToken.displayName']);
    });

    it('bails without a usable portrait', () => {
        expect(buildTokenPatch({ ...base, portrait: undefined })).toBeNull();
        expect(buildTokenPatch({ ...base, portrait: 'icons/svg/mystery-man.svg' })).toBeNull();
    });
});

describe('buildTokenPatch (legacy systems)', () => {
    const base = {
        systemId: 'dnd5e',
        actorType: 'npc',
        portrait: 'https://kanka.example/portrait.png',
        kankaTokenUrl: 'https://kanka.example/c/1/e/2/token.png',
        hasTokenFrame: false,
        ringDefaults: { 'prototypeToken.ring.subject.scale': 0.8 },
    };

    it('mirrors the pre-framed asset into both texture slots, keeps ring defaults', () => {
        const patch = buildTokenPatch(base);
        expect(patch).toMatchObject({
            'prototypeToken.texture.src': base.kankaTokenUrl,
            'prototypeToken.ring.subject.texture': base.kankaTokenUrl,
            'prototypeToken.ring.subject.scale': 0.8,
        });
        expect(patch).not.toHaveProperty(['prototypeToken.flags.wh40k-rpg.tokenFrame']);
    });

    it('falls back to the portrait when no Kanka token asset exists', () => {
        const patch = buildTokenPatch({ ...base, kankaTokenUrl: null });
        expect(patch).toMatchObject({
            'prototypeToken.texture.src': base.portrait,
            'prototypeToken.ring.subject.texture': base.portrait,
        });
    });

    it('bails with neither asset nor portrait', () => {
        expect(buildTokenPatch({ ...base, kankaTokenUrl: null, portrait: undefined })).toBeNull();
    });
});
