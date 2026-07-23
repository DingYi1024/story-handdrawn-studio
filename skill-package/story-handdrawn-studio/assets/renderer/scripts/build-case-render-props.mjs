#!/usr/bin/env node
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storyboardPath = resolve(root, 'examples', 'case-sprouting-note', 'storyboard.json');
const outputPath = resolve(root, 'examples', 'case-sprouting-note', 'render-props.json');
const storyboard = JSON.parse(readFileSync(storyboardPath, 'utf8'));
writeFileSync(outputPath, `${JSON.stringify({storyboard}, null, 2)}\n`, 'utf8');
console.log(outputPath);
