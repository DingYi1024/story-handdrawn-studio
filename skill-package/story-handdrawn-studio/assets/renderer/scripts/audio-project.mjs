import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {parseArgs, stringArg} from './lib/args.mjs';
import {processAudioProject, readAudioOptions} from './lib/audio.mjs';

const args = parseArgs(process.argv.slice(2));

const usage = () => console.log(`Optional audio sidecar

Usage:
  node scripts/audio-project.mjs --storyboard storyboard.json [--config audio-options.json]
  node scripts/audio-project.mjs --storyboard storyboard.json --config audio-options.json \\
    --enable --video output/final.mp4 --output output/final-with-audio.mp4

The pipeline is disabled unless --enable or {"enabled": true} is present in the config.
Per-scene voiceover, BGM, SFX, TTS, volume and loudness settings live in the config.`);

if (args.help === true || args.h === true) {
  usage();
  process.exit(0);
}

const storyboardArg = stringArg(args, 'storyboard');
if (!storyboardArg) throw new Error('--storyboard is required');
const storyboardPath = resolve(process.cwd(), storyboardArg);
const projectDir = resolve(process.cwd(), stringArg(args, 'project-dir', dirname(storyboardPath)));
const configPath = stringArg(args, 'config');
const options = configPath ? readAudioOptions(resolve(process.cwd(), configPath)) : {};
if (args.enable === true) options.enabled = true;
if (args.enable === false) options.enabled = false;
if (!options.base_dir) options.base_dir = configPath ? dirname(resolve(process.cwd(), configPath)) : projectDir;

const inputVideoArg = stringArg(args, 'video');
const outputVideoArg = stringArg(args, 'output');
const inputVideo = inputVideoArg ? resolve(process.cwd(), inputVideoArg) : resolve(projectDir, 'output', 'final.mp4');
const outputVideo = outputVideoArg ? resolve(process.cwd(), outputVideoArg) : resolve(projectDir, 'output', 'final-with-audio.mp4');
const manifestPath = resolve(
  process.cwd(),
  stringArg(args, 'manifest', resolve(projectDir, 'audio-manifest.json')),
);

const storyboard = JSON.parse(readFileSync(storyboardPath, 'utf8'));
const result = await processAudioProject({
  storyboard,
  options,
  projectDir,
  inputVideo,
  outputVideo,
  manifestPath,
});
console.log(JSON.stringify({
  enabled: result.enabled,
  manifest: result.manifest_path,
  output_video: result.output_video,
}, null, 2));

