import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateStoryboardFile} from './lib/storyboard-validator.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const skipAssets = args.includes('--skip-assets');
const jsonOutput = args.includes('--json');
const files = args.filter((arg) => !['--skip-assets', '--json'].includes(arg));
const storyboardFiles = files.length > 0
  ? files
  : ['storyboard.json', 'storyboard.uploaded.json'];

const reports = storyboardFiles.map((file) => {
  const absolute = resolve(root, file);
  return {file, ...validateStoryboardFile(absolute, {publicDir: resolve(root, 'public'), skipAssets})};
});

const errors = reports.flatMap((report) =>
  report.errors.map((error) => `${report.file}: ${error}`),
);

if (jsonOutput) {
  console.log(JSON.stringify({ok: errors.length === 0, skip_assets: skipAssets, reports}, null, 2));
} else {
  for (const report of reports) {
    if (report.errors.length === 0 && report.summary) {
      console.log(
        `✓ ${report.file} · ${report.summary.scenes} scenes · ` +
          `${report.summary.duration_seconds.toFixed(1)}s · ${report.summary.ratio}`,
      );
    }
  }
  if (errors.length > 0) console.error(errors.map((error) => `✗ ${error}`).join('\n'));
  else {
    console.log(
      skipAssets
        ? '✓ all storyboard structures valid · asset files not checked'
        : '✓ all storyboards and assets valid · silent picture tracks',
    );
  }
}

if (errors.length > 0) process.exit(1);
