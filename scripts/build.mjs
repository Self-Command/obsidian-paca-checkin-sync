import {build} from 'esbuild';
import {stat} from 'node:fs/promises';
await build({entryPoints:['src/main.ts'],bundle:true,external:['obsidian'],platform:'browser',target:'es2022',format:'cjs',outfile:'main.js',minify:true});
if((await stat('main.js')).size>250000)throw new Error('Plugin bundle exceeds the 250 kB budget');
