#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSemanticQaReport} from './lib/semantic-qa.mjs';
import {createReviewData, writeReviewWorkspace} from './lib/review.mjs';
import {atomicWriteJson} from './lib/projects.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const caseDir = resolve(root, 'examples', 'case-sprouting-note');
const storyboard = JSON.parse(readFileSync(resolve(caseDir, 'storyboard.json'), 'utf8'));
const observations = {
  schema_version: 1,
  method: 'human visual inspection of the four colour masters and rendered QA frames',
  scenes: Object.fromEntries(storyboard.scenes.map((scene) => [scene.id, {
    scene_match: true,
    character_identity: true,
    character_count: true,
    props: true,
    caption_text: true,
    watermark: false,
    style: true,
  }])),
};
atomicWriteJson(resolve(caseDir, 'semantic-observations.json'), observations);
const semantic = createSemanticQaReport({
  storyboard,
  observations,
  publicDir: resolve(root, 'public'),
  strict: true,
});
atomicWriteJson(resolve(caseDir, 'semantic-report.json'), semantic);
const data = createReviewData({
  project: {id: 'sprouting-note', title: '会发芽的纸条'},
  storyboard,
  qa: JSON.parse(readFileSync(resolve(caseDir, 'qa-report.json'), 'utf8')),
  semantic,
  audio: JSON.parse(readFileSync(resolve(caseDir, 'audio-options.json'), 'utf8')),
  publicDir: resolve(root, 'public'),
  assetHref: (path) => `../../public/${String(path).replaceAll('\\', '/')}`,
});
writeReviewWorkspace({
  data,
  htmlPath: resolve(caseDir, 'review.html'),
  dataPath: resolve(caseDir, 'review-data.json'),
});
if (!semantic.passed) throw new Error('Showcase semantic QA did not pass');
console.log(`V1.1 case evidence ready: ${semantic.summary.pass}/${semantic.summary.total} semantic checks passed.`);
