import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type ReferenceCollection from '../api/ReferenceCollection';
import type { KankaApiChildEntity } from '../types/kanka';
import PageFactory from './PageFactory';

const OWNERSHIP = { NONE: 0, INHERIT: -1 };

const references = {
    getRecord: () => ({}),
    findByEntityId: () => undefined,
    findByIdAndType: () => undefined,
} as unknown as ReferenceCollection;

function location(posts: { name: string; entry_parsed: string; visibility_id: number; position: number }[]): KankaApiChildEntity {
    return {
        id: 30,
        entity_id: 300,
        name: 'Hab District 4',
        has_custom_image: false,
        updated_at: '2026-10-14T00:00:00.000000Z',
        entry_parsed: '<h2>Key Locations</h2><p>The lodge.</p>',
        posts,
    } as unknown as KankaApiChildEntity;
}

describe('PageFactory post pages', () => {
    beforeEach(() => {
        vi.stubGlobal('game', { settings: { get: () => 'never' } });
        vi.stubGlobal('CONST', { DOCUMENT_OWNERSHIP_LEVELS: OWNERSHIP });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('hides the Entry page title, which would stack an empty label on the text (dh-campaign#43)', () => {
        const pages = new PageFactory(1, 'location', location([]), references).createPostPages().filter((p) => p !== null);
        const entry = pages.find((p) => p.name === 'KANKA.journal.shared.pages.entry');
        expect(entry?.title).toEqual({ show: false, level: 2 });
    });

    it('keeps a post page title, which names a real section such as GM Notes', () => {
        const gmNotes = { name: 'GM Notes', entry_parsed: '<p>The network meets here.</p>', visibility_id: 2, position: 1 };
        const pages = new PageFactory(1, 'location', location([gmNotes]), references).createPostPages().filter((p) => p !== null);
        const post = pages.find((p) => p.name === 'GM Notes');
        expect(post?.title).toEqual({ show: true, level: 2 });
        expect(post?.ownership).toEqual({ default: OWNERSHIP.NONE });
    });

    it('skips an empty entry entirely', () => {
        const entity = { ...location([]), entry_parsed: '' } as KankaApiChildEntity;
        const pages = new PageFactory(1, 'location', entity, references).createPostPages();
        expect(pages.filter((p) => p !== null)).toEqual([]);
    });
});
