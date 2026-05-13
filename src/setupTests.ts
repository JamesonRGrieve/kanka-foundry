import * as Handlebars from 'handlebars';
import { vi } from 'vitest';

(globalThis as { foundry: unknown }).foundry = { utils: {}, applications: { ux: { TextEditor: {} } } };

foundry.utils.getProperty = function getProperty(object: object, key: PropertyKey): unknown {
    if (!key) return undefined;
    let target: unknown = object;
    for (const p of String(key).split('.')) {
        if (target === null || typeof target !== 'object') return undefined;
        target = Reflect.get(target, p);
    }
    return target;
};

globalThis.Handlebars = Handlebars;

// biome-ignore lint/complexity/noStaticOnlyClass: This is just for testing and can't really be done differently
(foundry.applications.ux.TextEditor as { implementation: unknown }).implementation = class TextEditor {
    static enrichHTML(text: string): string {
        return text;
    }
};

vi.mock('./kanka.ts');
vi.mock('./scss.ts');
vi.mock('./templates.ts');
