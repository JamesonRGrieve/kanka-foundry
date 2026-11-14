import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReferenceCollection from '../api/ReferenceCollection';
import { createKankaChildEntity, createKankaPost } from '../types/kanka.fixtures';
import { KankaVisibility } from '../types/kanka';
import PageFactory from './PageFactory';

const OWNERSHIP = { NONE: 0, INHERIT: -1 };

function location(posts: ReturnType<typeof createKankaPost>[] = []) {
    return createKankaChildEntity({
        name: 'Hab District 4',
        updated_at: '2026-10-14T00:00:00.000000Z',
        entry_parsed: '<h2>Key Locations</h2><p>The lodge.</p>',
        posts,
    });
}

describe('PageFactory post pages', () => {
    beforeEach(() => {
        vi.stubGlobal('game', { settings: { get: () => 'never' } });
        vi.stubGlobal('CONST', { DOCUMENT_OWNERSHIP_LEVELS: OWNERSHIP });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const pagesOf = (entity: ReturnType<typeof location>) =>
        new PageFactory(1, 'location', entity, new ReferenceCollection(1)).createPostPages().filter((p) => p !== null);

    it('hides the Entry page title, which would stack an empty label on the text (dh-campaign#43)', () => {
        const entry = pagesOf(location()).find((p) => p.name === 'KANKA.journal.shared.pages.entry');
        expect(entry?.title).toEqual({ show: false, level: 2 });
    });

    it('keeps a post page title, which names a real section such as GM Notes', () => {
        const gmNotes = createKankaPost({
            name: 'GM Notes',
            entry_parsed: '<p>The network meets here.</p>',
            visibility_id: KankaVisibility.admin,
            position: 1,
        });
        const post = pagesOf(location([gmNotes])).find((p) => p.name === 'GM Notes');
        expect(post?.title).toEqual({ show: true, level: 2 });
        expect(post?.ownership).toEqual({ default: OWNERSHIP.NONE });
    });

    it('skips an empty entry entirely', () => {
        expect(pagesOf({ ...location(), entry_parsed: '' })).toEqual([]);
    });
});

describe('PageFactory keeps no second copy of the entity (wh40k-rpg#739)', () => {
    beforeEach(() => {
        vi.stubGlobal('game', { settings: { get: () => 'never' } });
        vi.stubGlobal('CONST', { DOCUMENT_OWNERSHIP_LEVELS: OWNERSHIP });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /** A page's `system.snapshot`, as created. */
    const snapshotOf = (page: object | null): Record<string, unknown> => {
        const system: unknown = page === null ? undefined : Reflect.get(page, 'system');
        const snapshot: unknown = system !== null && typeof system === 'object' ? Reflect.get(system, 'snapshot') : undefined;
        if (snapshot === null || typeof snapshot !== 'object') throw new Error('page has no snapshot');
        return { ...snapshot };
    };

    it('a post page carries its text and no snapshot', () => {
        const gmNotes = createKankaPost({ name: 'GM Notes', entry_parsed: '<p>The network meets here.</p>', position: 1 });
        const pages = new PageFactory(1, 'location', location([gmNotes]), new ReferenceCollection(1)).createPostPages().filter((p) => p !== null);
        expect(pages.length).toBe(2);
        for (const page of pages) expect(snapshotOf(page)).toEqual({});
    });

    it('the overview page carries only the fields its templates render', () => {
        const entity = { ...location(), type: 'Hab block', is_destroyed: false };
        const page = new PageFactory(1, 'location', entity, new ReferenceCollection(1)).createOverviewPage();
        const snapshot = snapshotOf(page);
        expect(snapshot['type']).toBe('Hab block');
        expect(snapshot['is_destroyed']).toBe(false);
        expect(snapshot).not.toHaveProperty('entry_parsed');
        expect(snapshot).not.toHaveProperty('posts');
        expect(snapshot).not.toHaveProperty('name');
    });
});
