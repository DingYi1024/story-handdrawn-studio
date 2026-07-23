import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {atomicWriteJson} from './projects.mjs';

export const REVIEW_SCHEMA_VERSION = 1;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export const createReviewData = ({project, storyboard, qa = null, semantic = null, audio = null, publicDir, assetHref = null}) => {
  const issuesByScene = new Map();
  for (const item of semantic?.checks || []) {
    if (item.status === 'pass') continue;
    issuesByScene.set(item.scene_id, [...(issuesByScene.get(item.scene_id) || []), item]);
  }
  const href = (path) => assetHref ? assetHref(path) : pathToFileURL(resolve(publicDir, path)).href;
  return {
    schema_version: REVIEW_SCHEMA_VERSION,
    project: {id: project.id, title: project.title},
    generated_at: new Date().toISOString(),
    qa: qa ? {status: qa.status, summary: qa.summary} : null,
    scenes: storyboard.scenes.map((scene) => ({
      id: String(scene.id),
      duration_sec: scene.duration_sec,
      text: scene.text || '', narration: scene.narration || '', visual: scene.visual || '',
      monochrome: scene.assets?.bw ? href(scene.assets.bw) : null,
      color: scene.assets?.color ? href(scene.assets.color) : null,
      issues: issuesByScene.get(String(scene.id)) || [],
      audio_events: (audio?.automatic_plan?.events || []).filter((event) => String(event.scene_id) === String(scene.id)),
    })),
  };
};

export const renderReviewHtml = (data) => {
  const payload = JSON.stringify(data).replaceAll('</script', '<\\/script');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(data.project.title)} · 审片台</title><style>
  :root{color-scheme:dark;--bg:#11110f;--panel:#1c1b18;--ink:#f4eedf;--muted:#aaa28f;--accent:#e9bd65;--bad:#e97969}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,"Microsoft YaHei",sans-serif}header{position:sticky;top:0;z-index:2;background:#11110fee;backdrop-filter:blur(12px);padding:18px 5vw;border-bottom:1px solid #34312b}h1{margin:0;font-size:22px}header p{margin:4px 0 0;color:var(--muted)}main{width:min(1380px,92vw);margin:24px auto 90px}.scene{display:grid;grid-template-columns:minmax(280px,460px) 1fr;gap:24px;background:var(--panel);border:1px solid #34312b;border-radius:18px;padding:18px;margin:18px 0}.images{display:grid;grid-template-columns:1fr 1fr;gap:8px}.images img{width:100%;aspect-ratio:9/16;object-fit:contain;background:white;border-radius:10px}.badge{display:inline-block;border:1px solid #5b5548;border-radius:99px;padding:2px 9px;color:var(--muted)}textarea{width:100%;min-height:84px;background:#11110f;color:var(--ink);border:1px solid #4c473c;border-radius:9px;padding:10px}.checks{display:flex;gap:16px;margin:12px 0}.issues{color:var(--bad)}button{background:var(--accent);border:0;border-radius:9px;padding:11px 16px;font-weight:700;cursor:pointer}.footer{position:fixed;bottom:0;left:0;right:0;padding:14px 5vw;background:#11110fee;border-top:1px solid #34312b;text-align:right}@media(max-width:800px){.scene{grid-template-columns:1fr}}
  </style></head><body><header><h1>${escapeHtml(data.project.title)} · 本地审片台</h1><p>逐场批准或填写返修意见，最后导出可被 Studio 应用的 JSON。</p></header><main id="app"></main><div class="footer"><button id="export">导出审片决定</button></div><script>const DATA=${payload};const app=document.querySelector('#app');
  const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  app.innerHTML=DATA.scenes.map(function(s){var images=(s.monochrome?'<img src="'+esc(s.monochrome)+'" alt="黑白图">':'')+(s.color?'<img src="'+esc(s.color)+'" alt="彩色图">':'');var issues=s.issues.length?'<p class="issues">'+s.issues.map(function(i){return esc(i.message)}).join('<br>')+'</p>':'';return '<section class="scene" data-id="'+esc(s.id)+'"><div class="images">'+images+'</div><div><span class="badge">场景 '+esc(s.id)+' · '+s.duration_sec+'s</span><h2>'+esc(s.text).replaceAll('\\n','<br>')+'</h2><p>'+esc(s.visual)+'</p>'+issues+'<div class="checks"><label><input type="radio" name="d-'+esc(s.id)+'" value="approve" checked> 批准</label><label><input type="radio" name="d-'+esc(s.id)+'" value="revise"> 返修</label></div><textarea placeholder="返修要求；批准时可留空"></textarea></div></section>'}).join('');
  document.querySelector('#export').onclick=()=>{const decisions=[...document.querySelectorAll('.scene')].map(el=>({scene_id:el.dataset.id,decision:el.querySelector('input:checked').value,note:el.querySelector('textarea').value.trim()}));const blob=new Blob([JSON.stringify({schema_version:1,project_id:DATA.project.id,decisions},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=DATA.project.id+'-review.json';a.click();URL.revokeObjectURL(a.href)};</script></body></html>`;
};

export const writeReviewWorkspace = ({data, htmlPath, dataPath}) => {
  mkdirSync(dirname(htmlPath), {recursive: true});
  atomicWriteJson(dataPath, data);
  writeFileSync(htmlPath, renderReviewHtml(data), 'utf8');
  return {html: htmlPath, data: dataPath};
};

export const validateReviewDecisions = (input, projectId, sceneIds) => {
  if (input?.schema_version !== 1 || input?.project_id !== projectId || !Array.isArray(input.decisions)) {
    throw new Error('Invalid review decision document');
  }
  const allowed = new Set(sceneIds.map(String));
  const seen = new Set();
  for (const item of input.decisions) {
    if (!allowed.has(String(item.scene_id)) || seen.has(String(item.scene_id))) throw new Error(`Invalid or duplicate review scene: ${item.scene_id}`);
    if (!['approve', 'revise'].includes(item.decision)) throw new Error(`Invalid review decision: ${item.decision}`);
    if (item.decision === 'revise' && !String(item.note || '').trim()) throw new Error(`Scene ${item.scene_id} needs a revision note`);
    seen.add(String(item.scene_id));
  }
  return input;
};
