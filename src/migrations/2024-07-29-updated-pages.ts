function assertType<T>(_value: unknown): asserts _value is T {}

interface ListEntry {
    id?: unknown;
    ref?: { id: unknown };
}

function getPageSystemSnapshot(page: JournalEntryPage): Record<string, unknown[]> | undefined {
    const sysRaw: unknown = page.system;
    if (sysRaw === null || typeof sysRaw !== 'object') return undefined;
    const snapshotRaw: unknown = Reflect.get(sysRaw, 'snapshot');
    if (snapshotRaw === null || typeof snapshotRaw !== 'object') return undefined;
    assertType<Record<string, unknown[]>>(snapshotRaw);
    return snapshotRaw;
}

function isOutdatedPage(page: JournalEntryPage): boolean {
    if (page.type !== 'kanka-foundry.children' && page.type !== 'kanka-foundry.family-members') return false;

    const snapshot = getPageSystemSnapshot(page);
    const list = snapshot?.['list'];
    return list?.every((e) => typeof e === 'object') ?? false;
}

// Migrate from old journal entry format to new page based format
export default async function migrate(): Promise<void> {
    const journals = Array.from(game.journal?.values() ?? []).filter((e) => e.getFlag('kanka-foundry', 'id'));

    for (const entry of journals) {
        const pages = Array.from(entry.pages.values()).filter(isOutdatedPage);

        const updates = pages
            .map((page: JournalEntryPage) => {
                const snapshot = getPageSystemSnapshot(page);
                if (!snapshot) return null;
                const rawList = snapshot['list'];
                const list: ListEntry[] = [];
                if (Array.isArray(rawList)) {
                    for (const item of rawList) {
                        assertType<ListEntry>(item);
                        list.push(item);
                    }
                }
                return {
                    _id: page._id,
                    system: {
                        snapshot: {
                            ...snapshot,
                            list: list.map(({ id, ref }) => id ?? ref?.id),
                        },
                    },
                };
            })
            .filter(Boolean);

        if (updates.length > 0) {
            assertType<JournalEntryPage.UpdateData[]>(updates);
            await entry.updateEmbeddedDocuments('JournalEntryPage', updates);
        }
    }
}
