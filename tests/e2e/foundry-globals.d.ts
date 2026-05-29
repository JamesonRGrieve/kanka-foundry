/*
 * Ambient Foundry runtime globals for Tier B e2e specs. These run inside
 * page.evaluate() in the browser context where the licensed Foundry app
 * injects them; they are intentionally loose. This file is e2e-only and is
 * NOT part of the module's typecheck/type-coverage surface (outside src/).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const game: any;
declare const ui: any;
declare const CONFIG: any;
declare const foundry: any;
