/* eslint-disable import/no-extraneous-dependencies */
import { flatten } from 'flat';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
import { dirname, join, relative } from 'path';
import { Plugin, ResolvedConfig, ViteDevServer } from 'vite';

export default function translationPlugin(): Plugin {
    let config: ResolvedConfig;
    let server: ViteDevServer | undefined;

    return {
        name: 'yaml-plugin',
        configResolved(resolvedConfig) {
            config = resolvedConfig;
        },
        configureServer(_server) {
            server = _server;
        },
        load(id) {
            if (!id.endsWith('.yml')) {
                return null;
            }

            const lib = config.build.lib;
            if (!lib) throw new Error('translationPlugin requires build.lib to be configured');
            const entry = typeof lib.entry === 'string' ? lib.entry : Object.values(lib.entry)[0];
            if (!entry) throw new Error('translationPlugin requires build.lib.entry to be set');
            const inputBasePath = dirname(entry);
            const inputRelativePath = relative(inputBasePath, id);
            const outputRelativePath = inputRelativePath.replace('.yml', '.json');
            const outputPath = join(config.build.outDir, outputRelativePath);

            const content = readFileSync(id, 'utf8');
            const json = flatten(
                yaml.load(content, {
                    schema: yaml.JSON_SCHEMA,
                    filename: id,
                }),
            );
            const jsonContent = JSON.stringify(json, null, 4);

            if (server) {
                mkdirSync(dirname(outputPath), { recursive: true });
                writeFileSync(outputPath, jsonContent);
            } else {
                this.emitFile({
                    type: 'asset',
                    fileName: outputRelativePath,
                    source: jsonContent,
                });
            }

            return 'export default "";';
        },
    };
}
