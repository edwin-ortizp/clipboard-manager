#!/usr/bin/env node
// team — CLI determinista del equipo de skills (sin dependencias).
// Uso: node .claude/team.mjs <comando> [args]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = '0.11.0';
const FOLDERS = ['to-do', 'in-progress', 'done', 'archived'];
const STATES = {
  'Borrador': 'to-do', 'Aprobado': 'to-do',
  'En desarrollo': 'in-progress', 'En verificación': 'in-progress',
  'Cerrado': 'done', 'Descartado': 'archived', 'Archivado': 'archived',
};
const LEVELS = ['XS', 'S', 'M', 'L'];
const REQUIRED = { XS: [0, 7, 8, 9], S: [0, 1, 7, 8, 9], M: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], L: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
const LABELS = ['En palabras simples', 'Resumen', 'Producto', 'UX/UI', 'Diseño técnico', 'Pruebas', 'Documentación', 'Tareas', 'Bitácora', 'Historial'];

const ROOT = findRoot(process.cwd());
const DOCS = path.join(ROOT, 'docs');
const BK = path.join(DOCS, 'backlog');
const SELF = fileURLToPath(import.meta.url);

function findRoot(start) {
  let c = start;
  for (;;) {
    if (fs.existsSync(path.join(c, '.git')) || fs.existsSync(path.join(c, 'docs', 'backlog'))) return c;
    const p = path.dirname(c);
    if (p === c) return start;
    c = p;
  }
}
const pad = n => String(n).padStart(2, '0');
function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); });
const out = s => process.stdout.write(s + '\n');
function fail(msg) { process.stderr.write('✖ ' + msg + '\n'); process.exit(1); }
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cambio';
}

// ---------- lectura de cambios ----------
function listChanges() {
  const res = [];
  for (const folder of FOLDERS) {
    const dir = path.join(BK, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const m = /^CHG-(\d+)/.exec(name);
      const file = path.join(dir, name, 'CHANGE.md');
      if (!m || !fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      res.push({ num: +m[1], id: `CHG-${m[1]}`, name, folder, dir: path.join(dir, name), file, text, ...parse(text) });
    }
  }
  return res.sort((a, b) => a.num - b.num);
}
function parse(text) {
  const title = (/^# CHG-\d+\s*·\s*(.+)$/m.exec(text) || [])[1]?.trim() || '';
  const state = (/^\*\*Estado:\*\*\s*(.+?)\s*$/m.exec(text) || [])[1] || '';
  const level = (/^\*\*Nivel:\*\*\s*(XS|S|M|L)\b/m.exec(text) || [])[1] || 'M';
  const model = (/^\*\*Modelo sugerido:\*\*\s*(.+?)\s*$/m.exec(text) || [])[1] || '';
  const tasks = [...text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/^- \[( |x|X)\] (.*)$/gm)];
  const done = tasks.filter(t => t[1] !== ' ').length;
  return { title, state, level, model, tasks, done, total: tasks.length };
}
function find(idArg) {
  if (!idArg) fail('Falta el ID del cambio (ej. CHG-003 o 3).');
  const n = +String(idArg).replace(/^CHG-?/i, '');
  if (!Number.isFinite(n)) fail(`ID inválido: ${idArg}`);
  const c = listChanges().find(x => x.num === n);
  if (!c) fail(`No existe CHG-${String(n).padStart(3, '0')} en docs/backlog/.`);
  return c;
}

// ---------- escritura ----------
function setState(text, state) { return text.replace(/^\*\*Estado:\*\*.*$/m, `**Estado:** ${state}`); }
function setDate(text, label, value) {
  return text.replace(new RegExp(`(\\*\\*${label}:\\*\\*)\\s*[^·\\n]*`), `$1 ${value} `).replace(/ +\n/g, '\n');
}
function addHistory(text, msg) {
  const actor = process.env.TEAM_ACTOR === 'panel' ? ' (desde el panel)' : '';
  return text.replace(/\s*$/, '') + `\n- ${today()} — ${msg}${actor}\n`;
}
function isGit() {
  try { execSync('git rev-parse --is-inside-work-tree', { cwd: ROOT, stdio: 'pipe' }); return true; } catch { return false; }
}
function moveTo(c, folder) {
  if (c.folder === folder) return c.dir;
  const destDir = path.join(BK, folder);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, c.name);
  if (fs.existsSync(dest)) fail(`Ya existe ${rel(dest)}.`);
  let moved = false;
  if (isGit()) {
    try { execSync(`git mv "${c.dir}" "${dest}"`, { cwd: ROOT, stdio: 'pipe' }); moved = true; } catch { /* no versionado aún */ }
  }
  if (!moved) fs.renameSync(c.dir, dest);
  return dest;
}
function save(c, text, folder) {
  const dir = folder ? moveTo(c, folder) : c.dir;
  fs.writeFileSync(path.join(dir, 'CHANGE.md'), text);
  syncPlan();
  return dir;
}

// ---------- validación ----------
function sectionBody(text, n) {
  const m = new RegExp(`^## ${n}\\.`, 'm').exec(text);
  if (!m) return null;
  const rest = text.slice(text.indexOf('\n', m.index) + 1);
  const nx = /^## \d+\./m.exec(rest);
  return nx ? rest.slice(0, nx.index) : rest;
}
function hasContent(body) {
  return body.split('\n').some(l => {
    const s = l.trim().replace(/^[-*]\s*/, '');
    if (!s || s.startsWith('<!--') || s.startsWith('#') || /^\|?[\s|:-]+\|?$/.test(s)) return false;
    if (/no aplica/i.test(s)) return true;
    if (s.startsWith('|')) return !/^\|\s*Caso\s*\|/.test(s);
    if (/:\s*$/.test(s) || /:\*\*\s*$/.test(s)) return false;
    return true;
  });
}
// Una parte de §3 "no aplica" solo si lo dice su primera línea con contenido.
function saysNotApplicable(body) {
  const first = body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).map(l => l.trim().replace(/^[-*]\s*/, '')).find(l => l && !l.startsWith('#'));
  return !!first && /^no aplica/i.test(first);
}
// Boceto: un bloque de código con contenido que no sea Mermaid.
function hasSketch(body) {
  return [...body.matchAll(/^\s*```([^\n]*)\n([\s\S]*?)^\s*```/gm)].some(m => !/mermaid/i.test(m[1]) && m[2].trim());
}
// Divide §3 por rol; las partes ausentes en CHG anteriores no se exigen.
function designParts(c) {
  const body = sectionBody(c.text, 3);
  if (body === null) return null;
  const clean = body.replace(/<!--[\s\S]*?-->/g, '');
  const heads = [...clean.matchAll(/^### 3\.([123])\b[^\n]*/gm)];
  if (!heads.length) return { ux: clean, ui: null, uxw: null };
  const parts = { ux: null, ui: null, uxw: null };
  const keys = { 1: 'ux', 2: 'ui', 3: 'uxw' };
  heads.forEach((m, i) => { parts[keys[m[1]]] = clean.slice(m.index, heads[i + 1]?.index ?? clean.length); });
  const preface = clean.slice(0, heads[0].index);
  if (parts.ux === null && hasContent(preface)) parts.ux = preface;
  return parts;
}
function validate(c, { forApproval = false } = {}) {
  const errors = [], warnings = [];
  const strict = forApproval ? errors : warnings;
  const req = REQUIRED[c.level];
  req.forEach(n => { if (sectionBody(c.text, n) === null) errors.push(`Falta la sección "## ${n}. ${LABELS[n]}" (nivel ${c.level}).`); });
  if (!STATES[c.state]) errors.push(`Estado desconocido: "${c.state}".`);
  else if (STATES[c.state] !== c.folder) errors.push(`Estado "${c.state}" no corresponde a la carpeta ${c.folder}/ (debería estar en ${STATES[c.state]}/).`);
  if (!c.title || c.title.includes('<')) errors.push('Falta el título del cambio.');
  for (const n of req.filter(n => n <= 6)) {
    const b = sectionBody(c.text, n);
    if (b !== null && !hasContent(b)) strict.push(`§${n} ${LABELS[n]} está vacía (llénala o escribe "No aplica — motivo").`);
  }
  // El boceto solo se exige al aprobar: los CHG ya aprobados no se revalidan con esta regla.
  const s3 = sectionBody(c.text, 3);
  if (forApproval && s3 !== null && c.level !== 'XS' && hasContent(s3.replace(/<!--[\s\S]*?-->/g, ''))) {
    const parts = designParts(c);
    if (parts.uxw !== null && !hasContent(parts.uxw)) errors.push('§3.3 Escritura está vacía (llénala o escribe "No aplica — motivo").');
    const applies = [parts.ux, parts.ui].filter(p => p !== null && !saysNotApplicable(p));
    if (applies.length && !hasSketch(s3)) errors.push('§3 describe UI pero no tiene boceto ASCII en un bloque de código (si no hay pantallas, escribe "No aplica — motivo").');
    // Anatomía: con UI, §3.1 nombra la plantilla de página. Se exige solo si el repo ya la definió.
    if (applies.length && !/^\s*-?\s*\**Plantilla:?\**:?\s*\S/im.test(parts.ux || s3)) {
      const ux = path.join(DOCS, 'UX-DESIGN.md');
      const hasAnatomy = fs.existsSync(ux) && /^## Anatom[ií]a\b/m.test(fs.readFileSync(ux, 'utf8'));
      (hasAnatomy ? errors : warnings).push(hasAnatomy
        ? '§3.1 no dice qué plantilla de página usa: agrega "Plantilla: <nombre>" según ## Anatomía de docs/UX-DESIGN.md.'
        : 'Este repo no define ## Anatomía en docs/UX-DESIGN.md: las pantallas nuevas no tienen una estructura común. Defínela con ux-designer.');
    }
  }
  if (c.total === 0) strict.push('§7 no tiene tareas ("- [ ] T1 · ...").');
  c.tasks.forEach(t => {
    const line = t[2];
    const id = (/^(T\d+)/.exec(line) || [])[1] || line.slice(0, 20);
    if (!/Hecho cuando:/i.test(line)) strict.push(`Tarea ${id} sin "Hecho cuando:".`);
    if (!/Resp:/i.test(line)) strict.push(`Tarea ${id} sin "Resp:".`);
  });
  if (c.level === 'L' && !c.text.includes('Dividido en:')) warnings.push('Nivel L: considera dividirlo en varios CHG de nivel M (anota "Dividido en: CHG-…").');
  const open = (sectionBody(c.text, 9) || '').split('\n').filter(l => /\?\s*(→\s*)?$/.test(l.trim()));
  if (open.length) strict.push(`§9 tiene ${open.length} pregunta(s) sin decisión.`);
  return { errors, warnings };
}
function report(c, r) {
  if (!r.errors.length && !r.warnings.length) { out(`✔ ${c.id} válido.`); return; }
  r.errors.forEach(e => out(`✖ ${e}`));
  r.warnings.forEach(w => out(`⚠ ${w}`));
}

// ---------- TEAM_PLAN ----------
function syncPlan() {
  const file = path.join(DOCS, 'TEAM_PLAN.md');
  const rows = listChanges().filter(c => c.folder !== 'archived')
    .map(c => `| ${c.id} | ${c.level} | ${c.title} | ${c.folder} | ${c.state} | ${c.done}/${c.total} |`);
  const table = ['<!-- team:table:start -->', '| CHG | Nivel | Título | Carpeta | Estado | Tareas |', '|---|---|---|---|---|---|', ...rows, '<!-- team:table:end -->'].join('\n');
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : planTemplate();
  text = /<!-- team:table:start -->[\s\S]*<!-- team:table:end -->/.test(text)
    ? text.replace(/<!-- team:table:start -->[\s\S]*<!-- team:table:end -->/, table)
    : text.replace(/\s*$/, '\n\n' + table + '\n');
  text = text.replace(/^_Última actualización:.*_$/m, `_Última actualización: ${today()}_`);
  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(file, text);
}
function planTemplate() {
  return `# Plan del equipo\n_Última actualización: ${today()}_\n\n> Tabla generada por \`node .claude/team.mjs\`. No la edites a mano.\n\n<!-- team:table:start -->\n<!-- team:table:end -->\n\n## Prioridades y dependencias\n\n## Decisiones y lecciones\n`;
}

function header(id, title, level, state, model) {
  return `# ${id} · ${title}
**Estado:** ${state}
**Nivel:** ${level}
**Modelo sugerido:** ${model}
<!-- Estados y nivel se cambian SOLO con node .claude/team.mjs. Modelo: un perfil de docs/TEAM_MODELS.md -->
**Creado:** ${today()} · **Aprobado:** ${state === 'Borrador' ? '—' : today()} · **Cerrado:** —
**Relacionado:** —

## 0. En palabras simples
<!-- Para el usuario: sin jerga. Si no se entiende en 30 segundos, reescríbelo. -->
- Qué vas a ver distinto:
- Cómo comprobarlo tú:
`;
}
const S_SUMMARY = `
## 1. Resumen
<!-- Qué y por qué, 2-3 líneas. Agrega solo la sección del rol afectado (## 3. UX/UI, ## 4. Diseño técnico o ## 5. Pruebas) si hace falta. Si hay UI, §3 lleva un boceto ASCII de la zona que cambia. -->
`;
const FULL_ROLES = `
## 1. Resumen
<!-- Qué se cambia y por qué (3-5 líneas). Entendimiento aprobado por el usuario. -->

## 2. Producto (product-manager)
- Problema / usuario:
- Incluye:
- No incluye:
- Criterios de aceptación (Dado/Cuando/Entonces):

## 3. UX/UI
<!-- Sin pantallas: escribe "No aplica — motivo" en cada parte. Con UI, approve exige un boceto ASCII en un bloque de código. Si hay flujo, agrega un diagrama en un bloque mermaid. -->
### 3.1 Experiencia (ux-designer)
- Flujo y cantidad de pasos:
- Qué contiene cada pantalla y qué es lo más importante:
- Estados (vacío / carga / error / éxito / validaciones):
- Información necesaria y momento de presentación:
- Accesibilidad de uso (teclado, foco, errores):

### 3.2 Visual (ui-designer)
- Distribución:
- Componentes existentes a reutilizar (ruta):
- Jerarquía, color, tipografía y espaciado (tokens):
- Responsive y contraste:

### 3.3 Escritura (ux-writer)
- Ubicación y estado:
- Textos finales (variables y variantes):
- Reglas de docs/UX-WRITING.md aplicadas:
- Criterios de aceptación de los textos:

## 4. Diseño técnico (software-architect)
- Archivos a crear / modificar:
- Enfoque y patrones a seguir:
- Riesgos y mitigación:
- Qué NO tocar:

## 5. Pruebas (qa-tester)
| Caso | Tipo | Nivel | Test |
|---|---|---|---|
- Comando para verificar:
- Regresión a vigilar:

## 6. Documentación (tech-writer)
- Docs a actualizar:
`;
function tail(firstTask) {
  return `
## 7. Tareas
<!-- Primero lo que cambia para el usuario; el detalle técnico después. Formato:
- [ ] T1 · qué cambia (en simple) — Resp: developer — Modelo: perfil — Archivos: … — Hecho cuando: … -->
${firstTask || ''}
## 8. Bitácora de implementación (developer)

## 9. Preguntas abiertas, decisiones e historial
`;
}
function changeTemplate(id, title, level, model) {
  const body = level === 'S' ? S_SUMMARY : FULL_ROLES;
  return header(id, title, level, 'Borrador', model) + body + tail() + `- ${today()} — Creado en to-do/ (Borrador, nivel ${level})\n`;
}
function quickTemplate(id, title, model) {
  return header(id, title, 'XS', 'En desarrollo', model)
    .replace('- Qué vas a ver distinto:', `- Qué vas a ver distinto: ${title}`)
    .replace('- Cómo comprobarlo tú:', '- Cómo comprobarlo tú: revisarlo en la pantalla afectada')
    + tail(`- [ ] T1 · ${title} — Resp: developer — Hecho cuando: el usuario lo confirma`)
    + `- ${today()} — Cambio rápido (XS) aprobado por solicitud directa del usuario → in-progress/\n`;
}

function modelsTemplate() {
  return `# Modelos del equipo
_Última revisión: ${today()}_

Perfiles que usan el triage y las tareas ("Modelo sugerido: perfil"). Edítalos desde el panel (\`team ui\` › Modelos), que solo ofrece lo disponible, o editando solo esta tabla.

| Perfil | Para qué | Proveedor / modelo | Esfuerzo | Modo |
|---|---|---|---|---|
| rapido | XS, textos, ajustes de UI, tareas mecánicas | | | |
| local | cambios acotados de código sin datos sensibles; trabajo offline | | | |
| estandar | S y M: implementación normal | | | |
| razonamiento | L, arquitectura, depuración difícil, crítica | | | |

## Reglas
- Por defecto: XS → rapido · S → estandar · M → estandar (diseño con razonamiento) · L → razonamiento.
- Código o datos sensibles → nunca a un proveedor no autorizado.
`;
}

// ---------- init ----------
const CLAUDE_BLOCK = `<!-- team:start -->
## Cómo trabaja este repo (equipo de skills)
- Lineamientos: \`docs/PRODUCT.md\`, \`docs/ARCHITECTURE.md\`, \`docs/UX-DESIGN.md\`, \`docs/UI-DESIGN.md\`, \`docs/UX-WRITING.md\`, \`docs/TESTING.md\`, \`docs/DOCUMENTATION.md\`. Respétalos siempre.
- Hallazgos por rol: \`docs/backlog/*.md\`. Cambios a implementar: \`docs/backlog/{to-do,in-progress,done,archived}/CHG-NNN-*/CHANGE.md\`.
- Punto de entrada para el usuario: la skill \`team\` (Claude Code: \`/team\` · Codex: \`$team\`) elige el rol.
- Todo cambio de código pasa por un CHG aprobado: la skill \`team\` lo especifica y \`developer\` lo implementa (Claude Code: \`/nombre\` · Codex: \`$nombre\` · Gemini: pide usar la skill por su nombre).
- Estados y numeración SOLO con \`node .claude/team.mjs\` (\`help\` para ver todo). \`loop\` y \`critique\` son opcionales y solo los inicia el usuario. Modelos por perfil: \`docs/TEAM_MODELS.md\`.
- Regla para cualquier agente: no edites archivos fuera de \`docs/\` si no hay un CHG "En desarrollo" (\`node .claude/team.mjs status\`). En Claude Code lo impone un hook (\`.claude/hooks/team-guard.mjs\`); donde no hay hook (Cowork, Codex, Gemini) ejecuta \`node .claude/team.mjs status\` antes de editar fuera de \`docs/\` y, sin un CHG En desarrollo, no edites. Nunca la desactives sin permiso del usuario.
- Si el perfil dice \`workspace: cowork\` (\`node .claude/team.mjs profile --json\`), la persona no tiene terminal: nunca le pidas ejecutar comandos; hazlo tú o indícale el botón del panel (\`team ui\`).
<!-- team:end -->`;

function init() {
  const created = [];
  for (const f of FOLDERS) {
    const d = path.join(BK, f);
    if (!fs.existsSync(d)) { fs.mkdirSync(d, { recursive: true }); created.push(rel(d) + '/'); }
    const keep = path.join(d, '.gitkeep');
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
  }
  if (!fs.existsSync(path.join(DOCS, 'TEAM_PLAN.md'))) { syncPlan(); created.push('docs/TEAM_PLAN.md'); }
  if (!fs.existsSync(CONFIG_FILE)) { fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n'); created.push('.claude/team.json (config de loop, opcional)'); }
  const mf = path.join(DOCS, 'TEAM_MODELS.md');
  if (!fs.existsSync(mf)) { fs.writeFileSync(mf, modelsTemplate()); created.push('docs/TEAM_MODELS.md (completa tus proveedores)'); }

  const cdir = path.join(ROOT, '.claude');
  fs.mkdirSync(path.join(cdir, 'hooks'), { recursive: true });
  const cliDest = path.join(cdir, 'team.mjs');
  if (path.resolve(SELF) !== path.resolve(cliDest)) { const ex = fs.existsSync(cliDest); fs.copyFileSync(SELF, cliDest); created.push('.claude/team.mjs' + (ex ? ' (actualizado)' : '')); }
  const guardSrc = path.join(path.dirname(SELF), 'team-guard.mjs');
  const guardDest = path.join(cdir, 'hooks', 'team-guard.mjs');
  if (fs.existsSync(guardSrc) && path.resolve(guardSrc) !== path.resolve(guardDest)) { const ex = fs.existsSync(guardDest); fs.copyFileSync(guardSrc, guardDest); created.push('.claude/hooks/team-guard.mjs' + (ex ? ' (actualizado)' : '')); }

  const sfile = path.join(cdir, 'settings.json');
  let settings = {};
  if (fs.existsSync(sfile)) { try { settings = JSON.parse(fs.readFileSync(sfile, 'utf8')); } catch { fail('.claude/settings.json no es JSON válido; corrígelo y repite.'); } }
  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  const cmd = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/team-guard.mjs"';
  const already = JSON.stringify(settings.hooks.PreToolUse).includes('team-guard.mjs');
  if (!already) {
    settings.hooks.PreToolUse.push({ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: cmd }] });
    fs.writeFileSync(sfile, JSON.stringify(settings, null, 2) + '\n');
    created.push('.claude/settings.json (hook team-guard)');
  }

  for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
    const file = path.join(ROOT, f);
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (cur.includes('<!-- team:start -->')) continue;
    fs.writeFileSync(file, (cur ? cur.replace(/\s*$/, '\n\n') : '') + CLAUDE_BLOCK + '\n');
    created.push(`${f} (bloque del equipo)`);
  }
  registerProjects([ROOT]);
  out(created.length ? '✔ Inicializado:\n  ' + created.join('\n  ') : '✔ Ya estaba inicializado; nada que hacer.');
  out('Lineamientos de cada rol: se crean con sus skills, con una entrevista corta (requieren aprobación).');
  out('Siguiente: abre `team ui` (vista Empezar) o escribe `/team empezar` en tu CLI de IA.');
}


// ---------- registro de proyectos ----------
const REGISTRY = path.join(process.env.AGENT_TEAM_HOME || path.join(os.homedir(), '.agent-team'), 'projects.json');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function loadProjects() {
  if (!fs.existsSync(REGISTRY)) return [];
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).projects || []; }
  catch { fail(`${REGISTRY} no es JSON válido; corrígelo o bórralo.`); }
}
function saveProjects(list) {
  fs.mkdirSync(path.dirname(REGISTRY), { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify({ projects: list }, null, 2) + '\n');
}
function registerProjects(roots) {
  const list = loadProjects();
  const added = roots.map(r => path.resolve(r)).filter(r => !list.some(x => samePath(x, r)));
  if (added.length) saveProjects([...list, ...added]);
  return added;
}
// Perfil personal y global (fuera de git): cómo llamar a la persona, su rol y cuánto detalle prefiere.
const PROFILE = path.join(path.dirname(REGISTRY), 'profile.json');
const PROFILE_FIELDS = { nombre: null, alias: null, rol: null, detalle: ['breve', 'normal', 'detallado'], idioma: null, workspace: ['cli', 'cowork'] };
// CHG-036: "…" es el texto de ejemplo de los comandos copiados, nunca un dato real.
const isPlaceholder = v => /^(…|\.\.\.)$/.test(String(v || '').trim());
function loadProfile() {
  if (!fs.existsSync(PROFILE)) return null;
  try { return JSON.parse(fs.readFileSync(PROFILE, 'utf8')); } catch { fail(`${PROFILE} no es JSON válido; corrígelo o bórralo.`); }
}
function profileCommand(args) {
  if (args[0] === 'set') {
    const pairs = args.slice(1);
    if (!pairs.length) fail('Uso: profile set alias="Ed" rol="líder técnico" detalle=breve');
    const profile = loadProfile() || {};
    for (const pair of pairs) {
      const i = pair.indexOf('=');
      const key = i > 0 ? pair.slice(0, i).trim() : '';
      const value = pair.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in PROFILE_FIELDS)) fail(`Campo desconocido: ${key || pair}. Campos: ${Object.keys(PROFILE_FIELDS).join(', ')}.`);
      if (PROFILE_FIELDS[key] && !PROFILE_FIELDS[key].includes(value)) fail(`${key} debe ser: ${PROFILE_FIELDS[key].join(', ')}.`);
      if (isPlaceholder(value)) fail(`${key} no puede ser el texto de ejemplo «…».`);
      if (value) profile[key] = value; else delete profile[key];
    }
    if (!profile.alias && !profile.nombre) fail('El perfil necesita alias o nombre.');
    fs.mkdirSync(path.dirname(PROFILE), { recursive: true });
    fs.writeFileSync(PROFILE, JSON.stringify(profile, null, 2) + '\n');
    out(`✔ Perfil guardado en ${PROFILE}`);
    return;
  }
  const profile = loadProfile();
  if (args.includes('--json')) { out(JSON.stringify(profile || {}, null, 2)); return; }
  if (!profile) { out(`Aún no tienes perfil. Créalo con:\n  team profile set alias="Ed" rol="líder técnico" detalle=breve\n(se guarda en ${PROFILE}, fuera de tus repos)`); return; }
  for (const k of Object.keys(PROFILE_FIELDS)) if (profile[k]) out(`${k.padEnd(8)} ${profile[k]}`);
  out(`\nArchivo: ${PROFILE}`);
}
function projectsCommand(args) {
  const [sub, target] = args;
  if (sub === 'scan') {
    if (!target) fail('Uso: projects scan <carpeta>');
    const base = path.resolve(target);
    if (!fs.existsSync(base)) fail(`No existe ${base}.`);
    const found = [base, ...fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(base, d.name))]
      .filter(d => fs.existsSync(path.join(d, '.claude', 'team.mjs')));
    const added = registerProjects(found);
    out(`✔ ${found.length} proyecto(s) encontrados, ${added.length} nuevo(s).`);
    added.forEach(a => out(`  ${a}`));
    return;
  }
  if (sub === 'remove') {
    if (!target) fail('Uso: projects remove <carpeta>');
    const list = loadProjects();
    const left = list.filter(x => !samePath(x, path.resolve(target)));
    if (left.length === list.length) fail(`${path.resolve(target)} no está registrado.`);
    saveProjects(left);
    out(`✔ Quitado del registro: ${path.resolve(target)} (sus archivos no se tocan).`);
    return;
  }
  if (sub) fail('Uso: projects | projects scan <carpeta> | projects remove <carpeta>');
  const list = loadProjects();
  if (!list.length) out('Sin proyectos registrados. Detéctalos con: team projects scan <carpeta>');
  list.forEach(p => out(`${(fs.existsSync(p) ? copyVersion(p) : 'no existe').padEnd(12)} ${p}`));
}

// ---------- actualización de proyectos ----------
const TEAM_BLOCK_RE = /<!-- team:start -->[\s\S]*?<!-- team:end -->/;
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
function copyVersion(root) {
  const f = path.join(root, '.claude', 'team.mjs');
  if (!fs.existsSync(f)) return 'sin instalar';
  return (/^const VERSION = '([^']+)'/m.exec(fs.readFileSync(f, 'utf8')) || [])[1] || 'sin versión';
}
function compareVersions(a, b) {
  const num = v => /^\d/.test(v) ? v.split('.').map(Number) : [0];
  const x = num(a), y = num(b);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}
function isGlobalCli(root) { return !samePath(path.resolve(SELF), path.resolve(root, '.claude', 'team.mjs')); }
// Calcula los cambios sin escribir nada.
function projectChanges(root) {
  const changes = [], warnings = [];
  const tool = (src, relDest) => {
    if (!fs.existsSync(src)) return;
    const content = fs.readFileSync(src, 'utf8');
    const dest = path.join(root, relDest);
    if (!fs.existsSync(dest) || !sameText(fs.readFileSync(dest, 'utf8'), content)) changes.push({ rel: relDest, content });
  };
  tool(SELF, '.claude/team.mjs');
  tool(path.join(path.dirname(SELF), 'team-guard.mjs'), '.claude/hooks/team-guard.mjs');
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
    const file = path.join(root, f);
    if (!fs.existsSync(file)) continue;
    const cur = fs.readFileSync(file, 'utf8');
    if (!TEAM_BLOCK_RE.test(cur)) continue;
    const block = cur.includes('\r\n') ? CLAUDE_BLOCK.replace(/\n/g, '\r\n') : CLAUDE_BLOCK;
    const next = cur.replace(TEAM_BLOCK_RE, () => block);
    if (!sameText(cur, next)) changes.push({ rel: f, content: next });
  }
  const sfile = path.join(root, '.claude', 'settings.json');
  try {
    const settings = fs.existsSync(sfile) ? JSON.parse(fs.readFileSync(sfile, 'utf8')) : {};
    if (!JSON.stringify(settings.hooks?.PreToolUse || []).includes('team-guard.mjs')) {
      settings.hooks ??= {};
      settings.hooks.PreToolUse ??= [];
      settings.hooks.PreToolUse.push({ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/team-guard.mjs"' }] });
      changes.push({ rel: '.claude/settings.json', content: JSON.stringify(settings, null, 2) + '\n' });
    }
  } catch { warnings.push('.claude/settings.json no es JSON válido; no se revisó el hook.'); }
  return { changes, warnings };
}
function applyChanges(root, changes) {
  for (const c of changes) {
    const dest = path.join(root, c.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, c.content);
  }
}
function changelogSince(from) {
  const file = path.join(path.dirname(SELF), '..', '..', '..', 'CHANGELOG.md');
  if (!fs.existsSync(file)) return '';
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return text.split(/^(?=## )/m).filter(s => {
    const v = (/^## .*\bv(\d+(?:\.\d+){0,2})\s*$/m.exec(s.split('\n')[0]) || [])[1];
    return v && compareVersions(v, VERSION) <= 0 && compareVersions(v, from) > 0;
  }).join('').trim();
}
function confirm(question) {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(`${question} [s/N] `);
  const buf = Buffer.alloc(16);
  const n = fs.readSync(0, buf, 0, 16, null);
  return /^s/i.test(buf.toString('utf8', 0, n).trim());
}
function update(args) {
  const all = args.includes('--all'), yes = args.includes('--yes'), dry = args.includes('--dry-run');
  if (!isGlobalCli(ROOT)) fail('Esta es la copia del proyecto. Actualiza con el comando global: team update');
  let roots;
  if (all) {
    roots = loadProjects();
    if (!roots.length) fail('Sin proyectos registrados. Detéctalos con: team projects scan <carpeta>');
  } else {
    if (!fs.existsSync(path.join(ROOT, '.claude', 'team.mjs'))) fail('Este repo no usa el equipo. Para instalarlo: team init');
    roots = [ROOT];
  }
  const pending = [];
  let lowest = VERSION;
  for (const root of roots) {
    if (!fs.existsSync(root)) { out(`⚠ ${root}: la carpeta no existe; se omite (quítala con: team projects remove "${root}").`); continue; }
    const from = copyVersion(root);
    if (from === 'sin instalar') { out(`⚠ ${root}: no tiene el equipo instalado; se omite.`); continue; }
    if (compareVersions(from, VERSION) > 0) { out(`⚠ ${root}: tiene ${from}, más nueva que ${VERSION}; se omite.`); continue; }
    const { changes, warnings } = projectChanges(root);
    warnings.forEach(w => out(`⚠ ${root}: ${w}`));
    if (!changes.length) { out(`✔ ${root}: al día (${from}).`); continue; }
    out(`↑ ${root}: ${from} → ${VERSION}`);
    changes.forEach(c => out(`    ${c.rel}`));
    pending.push({ root, changes });
    if (compareVersions(from, lowest) < 0) lowest = from;
  }
  if (!pending.length) { out('Nada que actualizar.'); return; }
  const notes = changelogSince(lowest);
  if (notes) out(`\nNovedades:\n${notes}`);
  if (dry) { out('\n(dry-run: no se modificó nada)'); return; }
  if (!yes && !confirm(`\n¿Actualizar ${pending.length} proyecto(s)?`)) {
    out(process.stdin.isTTY ? 'Cancelado; no se modificó nada.' : '\nNo se modificó nada. Para aplicarlo sin preguntar, repite con --yes.');
    return;
  }
  pending.forEach(p => applyChanges(p.root, p.changes));
  out(`✔ ${pending.length} proyecto(s) actualizados. No se hizo ningún commit: revisa y confirma en cada repo.`);
}
function outdatedWarning() {
  if (!isGlobalCli(ROOT)) return;
  const v = copyVersion(ROOT);
  if (v !== 'sin instalar' && compareVersions(v, VERSION) < 0) out(`\n⚠ Este repo usa la versión ${v} del equipo y hay ${VERSION}. Actualízalo con: team update`);
}

// ---------- configuración del loop (.claude/team.json) ----------
const CONFIG_FILE = path.join(ROOT, '.claude', 'team.json');
const DEFAULT_CONFIG = {
  _info: 'Configuración de "team loop" y "team critique". Solo la edita el usuario.',
  agent: ['claude', '-p', '--permission-mode', 'acceptEdits'],
  testCommand: '',
  batch: 3,
  maxTries: 3,
  maxDiffLines: { S: 300, M: 1000 },
  skillPrefix: '/',
  _ejemplos: {
    claude: ['claude', '-p', '--permission-mode', 'acceptEdits'],
    codex: ['codex', 'exec', '--full-auto', '{prompt}'],
    gemini: ['gemini', '--approval-mode', 'auto_edit', '-p', '{prompt}'],
    nota: 'Para Codex usa skillPrefix "$"; para Gemini "" (texto). Verifica los flags con --help de tu versión.',
  },
};
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
  catch { fail('.claude/team.json no es JSON válido.'); }
}

// ---------- utilidades git / agente ----------
function git(argv, opts = {}) {
  const r = spawnSync('git', argv, { cwd: ROOT, encoding: 'utf8', ...opts });
  if (r.status !== 0 && !opts.allowFail) fail(`git ${argv.join(' ')}: ${(r.stderr || '').trim()}`);
  return opts.raw ? (r.stdout || '') : (r.stdout || '').trim();
}
function changedFiles() {
  git(['add', '-A']);
  const names = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const lines = git(['diff', '--cached', '--numstat']).split('\n').filter(Boolean)
    .reduce((s, l) => { const [a, d] = l.split('\t'); return s + (+a || 0) + (+d || 0); }, 0);
  return { names, lines };
}
function runAgent(cfg, prompt) {
  const argv = cfg.agent.map(a => a === '{prompt}' ? prompt : a);
  const viaStdin = !cfg.agent.includes('{prompt}');
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: ROOT, encoding: 'utf8', input: viaStdin ? prompt : undefined,
    shell: process.platform === 'win32', stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, TEAM_LOOP: '1' },
  });
  if (r.error) fail(`No se pudo ejecutar el agente "${argv[0]}": ${r.error.message}. Revisa "agent" en .claude/team.json.`);
  return r.status;
}
function runTests(cmdline) {
  const r = spawnSync(cmdline, { cwd: ROOT, encoding: 'utf8', shell: true });
  const output = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  return { ok: r.status === 0, output };
}
const fingerprint = s => crypto.createHash('sha1').update(s.replace(/\d+(\.\d+)?\s*(ms|s)\b/g, '').replace(/\d{2}:\d{2}:\d{2}/g, '').slice(-3000)).digest('hex');
const lastLines = (s, n = 60) => s.split('\n').slice(-n).join('\n');

// ---------- alcance permitido ----------
function allowedPaths(c, task) {
  const grab = s => (s || '').split(/[,;]/).map(x => x.replace(/[`*]/g, '').replace(/\(.*?\)/g, '').trim())
    .filter(x => x && /[./]/.test(x) && !/\s/.test(x));
  const s4 = sectionBody(c.text, 4) || '';
  const fromS4 = grab((/Archivos a crear \/ modificar:(.*)$/m.exec(s4) || [])[1]);
  const fromTask = grab((/Archivos:\s*([^—]*)/.exec(task) || [])[1]);
  return [...new Set([...fromS4, ...fromTask])];
}
function outOfScope(files, allowed) {
  const isTest = f => /(^|\/)(tests?|__tests__|spec)\//i.test(f) || /\.(test|spec)\.[a-z]+$/i.test(f);
  const ok = f => f.startsWith('docs/') || isTest(f) || allowed.some(a => {
    const p = a.replace(/^\.\//, '');
    if (p.includes('*')) return new RegExp('^' + p.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(f);
    return f === p || f.startsWith(p.replace(/\/?$/, '/'));
  });
  return files.filter(f => !ok(f));
}

// ---------- prompts ----------
function taskPrompt(c, taskId, extra = '') {
  const pre = loadConfig().skillPrefix ?? '/';
  return `${pre ? pre + 'developer' : 'Usa la skill developer.'} ${c.id}
Estás dentro de "team loop" (modo no interactivo). Implementa SOLO la tarea ${taskId} de ${rel(path.join(BK, 'in-progress', c.name, 'CHANGE.md'))}.
Reglas:
- No hagas preguntas: no hay nadie para responder.
- Toca solo los archivos que permiten §4 y la tarea. No ejecutes comandos de team.mjs ni hagas commits.
- Al terminar, evalúa si hay una lección reutilizable con evidencia, motivo y destino. Regístrala en §9 con LECCIÓN(rol): texto, sin incorporarla ni aceptarla; si no hay aprendizaje, LECCIÓN: ninguna. Consulta las decisiones y lecciones vigentes antes de implementar.
- Al terminar, marca [x] ${taskId} en §7 y agrega una línea en §8 (qué cambió, en simple).
- Si la spec no cuadra con el código, es ambigua, o necesitas tocar algo fuera del alcance: NO implementes. Agrega en §9 una línea que empiece exactamente con "DESVIACIÓN:" explicando el problema y termina.${extra}`;
}
function critiquePrompt(c) {
  const pre = loadConfig().skillPrefix ?? '/';
  return `${pre ? pre + 'team' : 'Usa la skill team.'}
Actúa como CRÍTICO de especificaciones. Lee ${rel(c.file)} y los lineamientos en docs/. NO implementes nada y NO edites otra cosa que §9 de ese archivo.
Busca: ambigüedades, contradicciones, supuestos no confirmados, criterios no verificables, tareas que no se podrían hacer sin adivinar, riesgos de romper algo existente, y si §0 "En palabras simples" no refleja lo que dicen las tareas.
Por cada problema agrega en §9 una línea: "- ${today()} — CRÍTICO: <pregunta concreta>?" (debe terminar en "?"). Máximo 7, priorizadas. Si no hay problemas importantes, agrega "- ${today()} — CRÍTICO: sin observaciones."`;
}

// ---------- loop ----------
function devTasks(c) {
  return c.tasks.map(t => ({ done: t[1] !== ' ', line: t[2], id: (/^(T\d+)/.exec(t[2]) || [])[1] }))
    .filter(t => t.id && /Resp:\s*(?:developer|dev-implementer)(?=\s*(?:—|$))/i.test(t.line));
}
// Marca la tarea real: la alternativa de comentario evita tocar el ejemplo de la plantilla.
function markTaskDone(text, id) {
  let marked = false;
  return text.replace(new RegExp(`<!--[\\s\\S]*?-->|^- \\[ \\] ${id}\\b`, 'gm'), m => {
    if (m.startsWith('<!--') || marked) return m;
    marked = true;
    return m.replace('[ ]', '[x]');
  });
}
function stopLoop(c, reason, hint) {
  const fresh = find(c.id);
  fs.writeFileSync(fresh.file, addHistory(fresh.text, `Loop detenido: ${reason}`));
  out(`\n⛔ Loop detenido: ${reason}`);
  if (hint) out(hint);
  out('Revisa los cambios sin confirmar con "git status" / "git diff --cached". Para descartar el intento actual: git reset --hard HEAD');
  process.exit(2);
}
function loop(idArg, flags) {
  const cfg = loadConfig();
  let c = find(idArg);
  if (!isGit()) fail('team loop necesita git (rama y commit por tarea para poder deshacer).');
  if (!['S', 'M'].includes(c.level)) fail(`team loop es para niveles S y M (este es ${c.level}). ${c.level === 'XS' ? 'Un XS se hace directo.' : 'Divide el L en varios M.'}`);
  if (flags.dryRun) {
    if (!['Aprobado', 'En desarrollo'].includes(c.state)) fail(`${c.id} está en "${c.state}"; el loop necesita Aprobado o En desarrollo.`);
    const ts = devTasks(c).filter(t => !t.done); const first = !devTasks(c).some(t => t.done);
    out(`(dry-run) ${c.id} · nivel ${c.level} · rama chg/${c.name.replace(/^CHG-/i, '').toLowerCase()} · ${first ? 'bala trazadora: solo ' + (ts[0] || {}).id : 'lote: ' + ts.slice(0, +(flags.batch || cfg.batch)).map(t => t.id).join(', ')}`);
    ts.slice(0, first ? 1 : +(flags.batch || cfg.batch)).forEach(t => out(`\n--- prompt ${t.id} ---\n${taskPrompt(c, t.id)}`));
    out('\n(dry-run: no se ejecutó ni se modificó nada)');
    return;
  }
  if (c.state === 'Aprobado') { execSync(`node "${SELF}" start ${c.id}`, { cwd: ROOT, stdio: 'inherit' }); c = find(c.id); }
  if (c.state !== 'En desarrollo') fail(`${c.id} está en "${c.state}"; el loop necesita Aprobado o En desarrollo.`);

  const dirty = git(['status', '--porcelain'], { raw: true }).split('\n').filter(Boolean).map(l => l.slice(3).replace(/^"|"$/g, '')).filter(f => !f.startsWith('docs/') && !f.startsWith('.claude/') && !['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'].includes(f));
  if (dirty.length) fail(`Hay cambios sin confirmar fuera de docs/: ${dirty.slice(0, 5).join(', ')}. Haz commit o stash antes del loop.`);

  const branch = `chg/${c.name.replace(/^CHG-/i, '').toLowerCase()}`;
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (current !== branch) {
    const exists = git(['branch', '--list', branch]);
    git(['checkout', ...(exists ? [] : ['-b']), branch]);
    out(`↳ Rama ${branch}`);
  }
  git(['add', '-A']);
  if (git(['diff', '--cached', '--name-only'])) git(['commit', '-q', '-m', `${c.id}: especificación y estado`]);

  const testCmd = cfg.testCommand || ((/Comando para verificar:\s*`?([^`\n]+?)`?\s*$/m.exec(sectionBody(c.text, 5) || '') || [])[1] || '').trim();
  if (!testCmd || /no aplica/i.test(testCmd)) fail('No hay comando de verificación. Defínelo en §5 ("Comando para verificar: …") o en "testCommand" de .claude/team.json. Sin verificación automática no hay loop.');

  let tasks = devTasks(c).filter(t => !t.done);
  if (!tasks.length) { out('No quedan tareas de developer.'); }
  const anyDone = devTasks(c).some(t => t.done);
  const tracer = !anyDone;
  const batch = tracer ? 1 : Math.max(1, +(flags.batch || cfg.batch));
  tasks = tasks.slice(0, batch);
  const maxTries = Math.max(1, +(flags.tries || cfg.maxTries));
  const maxDiff = (cfg.maxDiffLines || {})[c.level] || 1000;

  out(`\n▶ team loop ${c.id} · nivel ${c.level} · verificación: ${testCmd}`);
  out(tracer ? '  Bala trazadora: solo la primera tarea; luego revisas tú.' : `  Lote: ${tasks.map(t => t.id).join(', ')} · intentos por tarea: ${maxTries} · diff máx.: ${maxDiff} líneas`);
  c = find(c.id); fs.writeFileSync(c.file, addHistory(c.text, `Loop iniciado (${tracer ? 'bala trazadora' : 'lote ' + tasks.map(t => t.id).join(', ')})`));

  for (const task of tasks) {
    out(`\n━━ ${task.id} · ${task.line.split('—')[0].replace(/^T\d+\s*·\s*/, '').trim()}`);
    let extra = '', lastFp = null;
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      out(`  intento ${attempt}/${maxTries}…`);
      const before = find(c.id).text;
      const code = runAgent(cfg, taskPrompt(c, task.id, extra));
      if (code !== 0) stopLoop(c, `el agente terminó con código ${code} en ${task.id}`);
      c = find(c.id);
      const newText = c.text.slice(0) ;
      if (/^.*DESVIACIÓN:/m.test(newText) && (newText.match(/DESVIACIÓN:/g) || []).length > (before.match(/DESVIACIÓN:/g) || []).length)
        stopLoop(c, `el agente reportó una desviación de la spec en ${task.id}`, 'Lee la línea "DESVIACIÓN:" en §9, corrige la spec con /team y vuelve a ejecutar el loop.');
      const { names, lines } = changedFiles();
      const code_ = names.filter(f => !f.startsWith('docs/'));
      if (!code_.length) stopLoop(c, `${task.id} no produjo cambios de código`);
      const allowed = allowedPaths(c, task.line);
      if (allowed.length) {
        const bad = outOfScope(names, allowed);
        if (bad.length) stopLoop(c, `${task.id} tocó archivos fuera del alcance: ${bad.slice(0, 5).join(', ')}`, `Permitidos por la spec: ${allowed.join(', ')}`);
      } else out('  ⚠ La spec no lista archivos (§4 o "Archivos:" en la tarea): sin control de alcance.');
      if (lines > maxDiff) stopLoop(c, `el cambio acumulado es de ${lines} líneas (máx. ${maxDiff} para nivel ${c.level})`, 'Puede que la spec sea más grande de lo previsto: divídela o sube el límite en .claude/team.json.');
      out(`  verificando: ${testCmd}`);
      const t = runTests(testCmd);
      if (t.ok) {
        c = find(c.id);
        let text = c.text;
        text = markTaskDone(text, task.id);
        text = addHistory(text, `Loop: ${task.id} hecho en ${attempt} intento(s), verificación OK`);
        fs.writeFileSync(c.file, text); syncPlan();
        git(['add', '-A']); git(['commit', '-q', '-m', `${c.id} ${task.id}: ${task.line.split('—')[0].replace(/^T\d+\s*·\s*/, '').trim()}`]);
        out(`  ✔ ${task.id} verificado y confirmado (commit).`);
        break;
      }
      const fp = fingerprint(t.output);
      if (fp === lastFp) stopLoop(c, `el mismo error se repitió en ${task.id}`, lastLines(t.output, 25));
      if (attempt === maxTries) stopLoop(c, `${task.id} no pasó la verificación tras ${maxTries} intentos`, lastLines(t.output, 25));
      lastFp = fp;
      extra = `\n\nEl intento anterior falló la verificación (${testCmd}). Corrige SOLO lo necesario para ${task.id}. Salida:\n${lastLines(t.output)}`;
    }
  }

  c = find(c.id);
  const pending = devTasks(c).filter(t => !t.done);
  if (tracer && pending.length) {
    out(`\n⏸ Bala trazadora lista. Revisa ${tasks[0].id} funcionando (guíate por §0). Si va bien: team loop ${c.id}`);
    out(`  Si va mal: git reset --hard HEAD~1, corrige la spec con /team y repite.`);
  } else if (pending.length) {
    out(`\n⏸ Lote terminado. Pendientes: ${pending.map(t => t.id).join(', ')}. Revisa y continúa con: team loop ${c.id}`);
  } else {
    out('\n✔ Todas las tareas de developer están hechas.');
    execSync(`node "${SELF}" verify ${c.id}`, { cwd: ROOT, stdio: 'inherit' });
    out(`  Demo: sigue §0 "En palabras simples". Rama: ${git(['rev-parse', '--abbrev-ref', 'HEAD'])}`);
  }
}

// ---------- ayuda ----------
const HELP = {
  init:     ['init', 'Instala el equipo en este repo: docs/backlog/, TEAM_PLAN.md, TEAM_MODELS.md, bloque en CLAUDE.md/AGENTS.md/GEMINI.md, hook de guardia (Claude Code) y .claude/team.json. Seguro de repetir: no pisa lo existente.', 'node .claude/team.mjs init'],
  status:   ['status [--all] [--json]', 'Tablero de cambios por carpeta con nivel, estado y avance. --all incluye archived/. --json entrega todos los datos sin modificar nada.', 'node .claude/team.mjs status'],
  next:     ['next [CHG-NNN]', 'Qué sigue en cada cambio activo y quién lo hace.', 'team next'],
  show:     ['show CHG-NNN', 'Resumen de un cambio y sus tareas pendientes.', 'node .claude/team.mjs show 3'],
  quick:    ['quick "título" [--model perfil]', 'XS: cambio trivial (texto, color, botón). Queda aprobado y En desarrollo al instante; luego "close".', 'node .claude/team.mjs quick "Cambiar texto del botón Guardar"'],
  new:      ['new "título" [--level S|M|L] [--model perfil]', 'Crea un CHG en to-do/ (Borrador) con la plantilla del nivel. Por defecto M.', 'node .claude/team.mjs new "Filtro por fecha" --level S'],
  level:    ['level CHG-NNN S|M|L', 'Cambia el nivel de un CHG que aún está en to-do/.', 'node .claude/team.mjs level 4 M'],
  validate: ['validate [CHG-NNN]', 'Revisa estructura, estado/carpeta, tareas y preguntas abiertas. Sin ID revisa todos.', 'node .claude/team.mjs validate 3'],
  critique: ['critique CHG-NNN [--dry-run]', 'Opcional: un agente crítico revisa la spec y escribe preguntas en §9. "approve" queda bloqueado hasta que las respondas.', 'node .claude/team.mjs critique 3'],
  approve:  ['approve CHG-NNN', 'Compuerta 2: Borrador → Aprobado. Falla si hay secciones vacías, tareas sin "Hecho cuando" o preguntas sin responder.', 'node .claude/team.mjs approve 3'],
  start:    ['start CHG-NNN [--force]', 'Aprobado → in-progress/ En desarrollo. Desde aquí el hook permite editar código.', 'node .claude/team.mjs start 3'],
  loop:     ['loop CHG-NNN [--batch N] [--tries N] [--dry-run]', 'Opcional: implementación automática con verificación: rama chg/…, un commit por tarea, bala trazadora (solo T1 la primera vez), reintentos con el error, y se detiene si sale del alcance, el diff crece demasiado, el error se repite o el agente reporta DESVIACIÓN. Solo S y M. Usa .claude/team.json.', 'node .claude/team.mjs loop 3 --dry-run'],
  verify:   ['verify CHG-NNN', 'En desarrollo → En verificación (exige las tareas de developer hechas).', 'node .claude/team.mjs verify 3'],
  reopen:   ['reopen CHG-NNN "motivo"', 'En verificación → En desarrollo (QA o el demo falló).', 'node .claude/team.mjs reopen 3 "el filtro ignora la zona horaria"'],
  close:    ['close CHG-NNN [--force "motivo"]', 'Compuerta 3: → done/ Cerrado. Exige todas las tareas hechas (XS cierra directo). --force: el usuario cierra un cambio que ya probó, desde Aprobado, En desarrollo o En verificación; marca las pendientes y guarda el motivo. Solo si el usuario lo pide.', 'node .claude/team.mjs close 3 --force "ya lo probé"'],
  archive:  ['archive CHG-NNN "motivo"', '→ archived/ (Descartado o Archivado).', 'node .claude/team.mjs archive 5 "ya no se necesita"'],
  update:   ['update [--all] [--dry-run] [--yes]', 'Actualiza el CLI, la guardia y el bloque de reglas de este repo, o de todos los registrados con --all. Muestra antes qué cambiará, pide confirmación y nunca hace commits ni toca docs/.', 'team update --all --dry-run'],
  profile:  ['profile [--json] | profile set campo=valor …', 'Tu perfil personal (fuera de los repos): nombre, alias, rol, detalle (breve, normal o detallado), idioma y workspace (cli o cowork: dónde trabajas; con cowork el panel no pide terminal). Los agentes te llaman por tu alias y ajustan el detalle.', 'team profile set alias="Ed" rol="líder técnico" detalle=breve'],
  projects: ['projects [scan <carpeta> | remove <carpeta>]', 'Lista los proyectos registrados, detecta los de una carpeta o quita uno del registro.', 'team projects scan C:\\laragon\\www'],
  lessons:  ['lessons [--from-commits [desde] [--to ref] [--max N] [--dry-run]] | lessons preview LSN-NNN|CHG-NNN#n <destino> [--json] | lessons accept LSN-NNN|CHG-NNN#n <destino> --proposal <token> [--apply] | lessons discard LSN-NNN|CHG-NNN#n "motivo" | lessons --json', 'Lecciones por incorporar. preview prepara regla, motivo, alcance y diff; no cambia el destino. accept exige el token del diff revisado, escribe y verifica antes de marcar; --apply es un alias compatible y no omite la revisión. Admite CHG y commits. Conflictos bloquean; cambios concurrentes exigen nueva propuesta. Destinos: docs/*.md, instrucciones, fuentes de skills del repo o backlog de rol (registra hallazgo, corrección mediante CHG). Una skill fuera de docs exige CHG En desarrollo; las compartidas se editan en su repo fuente. --from-commits compara commits con lineamientos e instrucciones y propone LSN-NNN; --json muestra el registro.', 'team lessons preview LSN-003 docs/ARCHITECTURE.md'],
  ui:       ['ui [--port N] [--browser] [--no-open]', 'Abre el panel en ventana de aplicación (Edge/Chrome); --browser usa una pestaña, --no-open solo inicia el servidor.', 'team ui'],
  help:     ['help [comando | flujo]', 'Esta ayuda. "help flujo" muestra qué usar según el tamaño de la tarea.', 'node .claude/team.mjs help loop'],
};
const FLOW = `Qué usar según la tarea
  XS  botón, texto, color      quick "…"  → implementar → close
  S   ajuste acotado            new "…" --level S → llenar → approve → start → implementar → verify → close
  M   funcionalidad             /team (entrevista + roles) → approve → start → implementar → verify → close
  L   iniciativa grande         dividir en varios M

Opcionales (tú decides cuándo):
  critique CHG   antes de approve: un crítico busca huecos en la spec
  loop CHG       en lugar de implementar a mano: automático, con frenos y un commit por tarea

Sin loop, implementas con /developer CHG-NNN como siempre.`;
const canonicalRole = role => ({ 'dev-team-lead': 'team', 'dev-implementer': 'developer' })[role] || role;
function nextStep(c) {
  switch (c.state) {
    case 'Borrador': return `completar la spec y aprobar: team approve ${c.id}`;
    case 'Aprobado': return `implementar: /developer ${c.id}`;
    case 'En desarrollo': {
      const t = c.tasks.find(x => x[1] === ' ');
      if (!t) return c.level === 'XS' ? `cerrar: team close ${c.id}` : `pasar a verificación: team verify ${c.id}`;
      const id = (/^(T\d+)/.exec(t[2]) || [])[1] || 'siguiente tarea';
      const resp = (/Resp:\s*([^—]+)/.exec(t[2]) || [])[1]?.trim() || 'sin responsable';
      return `${id} (${canonicalRole(resp)})`;
    }
    case 'En verificación': return `cerrar si ya lo probaste: team close ${c.id} (o volver a probar: /qa-tester ${c.id})`;
    default: return '';
  }
}
const ROLE_SECTIONS = { pm: 2, arquitectura: 4, qa: 5, docs: 6 };
const statusOf = body => saysNotApplicable(body) ? 'no aplica' : hasContent(body) ? 'aportó' : 'pendiente';
// Indica si la sección del rol tiene contenido, no si su skill se ejecutó.
function roleStatus(c, n) {
  const body = sectionBody(c.text, n);
  if (body === null) return REQUIRED[c.level].includes(n) ? 'pendiente' : 'no aplica';
  return statusOf(body.replace(/<!--[\s\S]*?-->/g, ''));
}
function roles(c) {
  const parts = designParts(c);
  const missing = REQUIRED[c.level].includes(3) ? 'pendiente' : 'no aplica';
  const r = Object.fromEntries(Object.entries(ROLE_SECTIONS).map(([k, n]) => [k, roleStatus(c, n)]));
  return { ...r, ux: parts?.ux != null ? statusOf(parts.ux) : parts ? 'no aplica' : missing, ui: parts?.ui ? statusOf(parts.ui) : parts ? 'no aplica' : missing, uxw: parts?.uxw ? statusOf(parts.uxw) : 'no aplica' };
}
// Lecciones de §9: "LECCIÓN(rol): texto", incorporada si termina en "→ docs/ARCHIVO"; "LECCIÓN: ninguna" las descarta.
const LESSON_LINE = /^.*?LECCI[ÓO]N(?:\(([^)]*)\))?:[ \t]*(.+?)[ \t]*\r?$/gm;
const LESSON_TARGET = /\s*→\s*([^\s→]+\.md(?:#[\w-]+)?)$/;
// Todas las lecciones declaradas en §9 (sin "ninguna"), numeradas en orden: CHG-NNN#1, #2…
function chgLessons(c) {
  const clean = (sectionBody(c.text, 9) || '').replace(/<!--[\s\S]*?-->/g, '');
  return [...clean.matchAll(LESSON_LINE)].filter(m => !/^ninguna\.?$/i.test(m[2])).map((m, i) => {
    const discarded = (/\s*→\s*descartada:?\s*(.*)$/i.exec(m[2]) || [])[1];
    const target = discarded === undefined ? (LESSON_TARGET.exec(m[2]) || [])[1] || null : null;
    const text = m[2].replace(/\s*→\s*descartada\b.*$/i, '').replace(LESSON_TARGET, '');
    return { key: `${c.id}#${i + 1}`, role: (m[1] || '').trim(), text, target, discarded: discarded === undefined ? null : discarded || '—' };
  });
}
function lessonsOf(c) {
  const clean = (sectionBody(c.text, 9) || '').replace(/<!--[\s\S]*?-->/g, '');
  const declared = [...clean.matchAll(LESSON_LINE)].length > 0;
  return { items: chgLessons(c).filter(l => l.discarded === null).map(({ role, text, target }) => ({ role, text, target })), declared };
}
function lessonsSummary(c) {
  const { items, declared } = lessonsOf(c);
  return { items, unreviewed: !declared && c.folder === 'done' };
}
const LSN_FILE = path.join(BK, 'LESSONS-FROM-COMMITS.md');
const LSN_RE = /^- (LSN-\d{3,}) · (.+?)[ \t]*\r?$/gm;
function commitLessons() {
  if (!fs.existsSync(LSN_FILE)) return [];
  return [...fs.readFileSync(LSN_FILE, 'utf8').matchAll(LSN_RE)].map(m => {
    const mark = /\s*→\s*(.+)$/.exec(m[2]);
    const decision = mark ? (/^descartada/.test(mark[1]) ? 'descartada' : 'incorporada') : 'pendiente';
    return { id: m[1], text: mark ? m[2].slice(0, mark.index) : m[2], decision, mark: mark ? mark[1] : null };
  });
}
function lsnHeader(last) {
  return `# Lecciones a partir de los commits\nÚltimo commit revisado: ${last}\n<!-- Lo genera "team lessons --from-commits". Revisa cada propuesta con "team lessons preview LSN-NNN docs/ARCHIVO.md" o "team lessons discard LSN-NNN 'motivo'". -->\n`;
}
const GUIDES = ['PRODUCT', 'ARCHITECTURE', 'UX-DESIGN', 'UI-DESIGN', 'UX-WRITING', 'SECURITY', 'PERFORMANCE', 'TESTING', 'DOCUMENTATION'];
const SKIP_DIFF = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock)$|\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|min\.js|map)$|(^|\/)(dist|build|vendor|node_modules)\//;
function commitsPackage(from, to, max) {
  let range = [to];
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) range = [`--since=${from}`, to];
  else if (from) range = [`${from}..${to}`];
  const hashes = git(['log', '--format=%H', `--max-count=${max}`, ...range]).split('\n').filter(Boolean).reverse();
  const allFiles = new Set(), haystack = [];
  const blocks = hashes.map(h => {
    const head = git(['show', '-s', '--format=%h · %ad · %an · %s', '--date=short', h]);
    const files = git(['show', '--format=', '--numstat', '--no-renames', h]).split('\n').filter(Boolean)
      .map(l => { const [a, d, f] = l.split('\t'); return { f, stat: a === '-' ? `${f} (binario)` : `${f} (+${a} −${d})` }; });
    const shown = files.filter(x => !SKIP_DIFF.test(x.f)).map(x => x.f);
    const diff = shown.length ? git(['show', '--format=', '--unified=1', '--no-renames', h, '--', ...shown], { raw: true }).split('\n') : [];
    const cut = diff.length > 80 ? diff.slice(0, 80).concat(`… (${diff.length - 80} líneas más omitidas)`) : diff;
    files.forEach(x => allFiles.add(x.f));
    haystack.push(head, cut.join('\n'));
    return `### ${head}\nArchivos: ${files.map(x => x.stat).join(', ')}\n\`\`\`diff\n${cut.join('\n').trim()}\n\`\`\``;
  });
  return { hashes, text: blocks.join('\n\n'), files: [...allFiles], haystack: haystack.join('\n') };
}
const SKILL_ROOTS = ['.claude/skills', '.agents/skills', 'skills'];
function listSkills() {
  const seen = new Map();
  for (const root of SKILL_ROOTS) {
    const dir = path.join(ROOT, root);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const fm = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(text) || [])[1] || '';
      const field = k => ((new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(fm) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
      const skill = field('name') || name;
      if (!seen.has(skill)) seen.set(skill, { name: skill, description: field('description'), dir: `${root}/${name}`, file: `${root}/${name}/SKILL.md`, text });
    }
  }
  return [...seen.values()];
}
function relevantSkill(s, pkg) {
  if (pkg.files.some(f => f.startsWith(s.dir + '/'))) return true;
  if (!(s.name.length >= 4 || s.name.includes('-'))) return false;
  const esc = s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w-])${esc}($|[^\\w-])`).test(pkg.haystack);
}
const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];
function agentInstructions() {
  const groups = [];
  for (const f of INSTRUCTION_FILES) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const body = fs.readFileSync(p, 'utf8').replace(TEAM_BLOCK_RE, '').replace(/\r\n/g, '\n').trim();
    if (!body) continue;
    const same = groups.find(g => g.body === body);
    if (same) same.files.push(f); else groups.push({ files: [f], body });
  }
  return groups.map(g => `## ${g.files.join(' = ')}\n${g.body}`).join('\n\n');
}
function fromCommitsPrompt(pkg, rangeLabel) {
  const guides = GUIDES.map(g => path.join(DOCS, g + '.md')).filter(f => fs.existsSync(f))
    .map(f => `## ${rel(f)}\n${fs.readFileSync(f, 'utf8')}`).join('\n\n') || '(No hay lineamientos en docs/.)';
  const discarded = commitLessons().filter(l => l.decision === 'descartada').map(l => `- ${l.text} → ${l.mark}`).join('\n') || '—';
  const skills = listSkills();
  const full = skills.filter(s => relevantSkill(s, pkg));
  const cap = t => { const l = t.split('\n'); return l.length > 300 ? l.slice(0, 300).join('\n') + `\n… (${l.length - 300} líneas más omitidas)` : t; };
  const index = skills.map(s => `- ${s.name} (${s.file}): ${s.description || '—'}`).join('\n') || '(El repo no tiene skills.)';
  const skillText = full.map(s => `## ${s.file}\n${cap(s.text)}`).join('\n\n') || '(Ninguna skill se modificó ni se mencionó en estos commits.)';
  return `Actúa como revisor de lineamientos. NO implementes nada y NO edites otro archivo que ${rel(LSN_FILE)}.
Compara lo que realmente se hizo en estos commits (${rangeLabel}) con los lineamientos, las instrucciones para agentes y las skills del proyecto. NO resumas los commits.
Propón una lección solo si:
- la práctica real contradice un lineamiento, una instrucción o una skill, revela algo que les falta o muestra que una regla no se usa o ya no sirve (tipos agregar, cambiar o quitar; destino: el lineamiento, CLAUDE.md/AGENTS.md/GEMINI.md o la ruta del SKILL.md);
- un commit viola una regla vigente que sigue siendo correcta (tipo corregir; destino: docs/backlog/<PRODUCT|ARCHITECTURE|UX-DESIGN|UI-DESIGN|UX-WRITING|SECURITY|PERFORMANCE|TESTING|DOCUMENTATION>.md). Nunca propongas editar código directamente.
Agrega al final de ${rel(LSN_FILE)} una línea por propuesta, sin ID (el CLI lo pone):
- LECCIÓN(<producto|ux|ui|uxw|seguridad|rendimiento|arquitectura|qa|docs>): <agregar|cambiar|quitar|corregir> — <texto concreto> (commits: <hash>, <hash>) · destino sugerido: <ruta>
Máximo 7, priorizadas. Si no hay nada importante, agrega "- LECCIÓN: ninguna".
No repitas propuestas ya descartadas:
${discarded}

# Lineamientos
${guides}

# Instrucciones para agentes
${agentInstructions() || '(No hay CLAUDE.md, AGENTS.md ni GEMINI.md con contenido propio.)'}

# Skills del repo (índice)
${index}

# Skills relevantes para estos commits (texto completo)
${skillText}

# Commits
${pkg.text}`;
}
function fromCommits(args) {
  if (!isGit()) fail('Este proyecto no es un repositorio git.');
  const opt = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
  const to = opt('--to') || 'HEAD';
  const max = parseInt(opt('--max') || '30', 10);
  if (!(max > 0)) fail('--max debe ser un número mayor que 0.');
  const valued = new Set(['--to', '--max']);
  const pos = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
  const existing = fs.existsSync(LSN_FILE) ? fs.readFileSync(LSN_FILE, 'utf8') : '';
  const last = (/^Último commit revisado:\s*(\S+)/m.exec(existing) || [])[1];
  const from = pos[0] || (last && last !== '—' ? last : null);
  const pkg = commitsPackage(from, to, max);
  if (!pkg.hashes.length) { out(`No hay commits nuevos${from ? ` desde ${from}` : ''}. Nada que revisar.`); return; }
  const count = pkg.hashes.length, first = pkg.hashes[0].slice(0, 7), lastShort = pkg.hashes.at(-1).slice(0, 7);
  const rangeLabel = count === 1 ? `${first}, 1 commit` : `${first}..${lastShort}, ${count} commits`;
  const prompt = fromCommitsPrompt(pkg, rangeLabel);
  if (args.includes('--dry-run')) { out(prompt); return; }
  fs.mkdirSync(BK, { recursive: true });
  fs.writeFileSync(LSN_FILE, (existing || lsnHeader('—')).replace(/\s*$/, '\n') + `\n## ${today()} · ${rangeLabel}\n`);
  const code = runAgent(loadConfig(), prompt);
  if (code !== 0) {
    // Sin propuestas válidas: se deshace el encabezado de esta corrida para no dejarlo huérfano.
    if (existing) fs.writeFileSync(LSN_FILE, existing); else fs.rmSync(LSN_FILE, { force: true });
    fail(`El agente terminó con código ${code}. No se registró la corrida; vuelve a intentarlo.`);
  }
  let text = fs.readFileSync(LSN_FILE, 'utf8');
  let n = commitLessons().reduce((m, l) => Math.max(m, +l.id.slice(4)), 0);
  const added = [];
  text = text.replace(/^- (LECCI[ÓO]N(?:\([^)]*\))?:.*?)(\r?)$/gm, (m, line, cr) => {
    if (/^LECCI[ÓO]N:\s*ninguna/i.test(line)) return m;
    const id = `LSN-${String(++n).padStart(3, '0')}`; added.push(`${id} · ${line}`); return `- ${id} · ${line}${cr}`;
  });
  text = text.replace(/^Último commit revisado:.*$/m, `Último commit revisado: ${pkg.hashes.at(-1)}`);
  fs.writeFileSync(LSN_FILE, text);
  out(added.length ? `\nPropuestas (${rel(LSN_FILE)}):\n` + added.map(l => '  ' + l).join('\n') + '\n\nRevisa cada una: team lessons preview LSN-NNN docs/ARCHIVO.md · team lessons discard LSN-NNN "motivo"' : 'El agente no propuso lecciones.');
}
const BACKLOG_PREFIX = { PRODUCT: 'PRD', ARCHITECTURE: 'ARQ', 'UX-DESIGN': 'UX', 'UI-DESIGN': 'UI', 'UX-WRITING': 'UXW', SECURITY: 'SEC', PERFORMANCE: 'PERF', TESTING: 'QA', DOCUMENTATION: 'DOC' };
const BACKLOG_TARGET = /^docs\/backlog\/(PRODUCT|ARCHITECTURE|UX-DESIGN|UI-DESIGN|UX-WRITING|SECURITY|PERFORMANCE|TESTING|DOCUMENTATION)\.md$/;
function isLessonTarget(t) {
  return BACKLOG_TARGET.test(t) || (/^docs\/[^/]+\.md$/.test(t)) || INSTRUCTION_FILES.includes(t)
    || SKILL_ROOTS.some(r => t.startsWith(r + '/') && /^[^/]+\/SKILL\.md$/.test(t.slice(r.length + 1)));
}
// Propuestas revisables. La IA devuelve texto; solo el CLI escribe después de aceptar.
const PREVIEW_DIR = path.join(BK, '.lesson-previews');
const lessonHash = text => crypto.createHash('sha256').update(text).digest('hex');
function lessonPath(target) {
  if (!isLessonTarget(target) || target.includes('..') || target.includes('\\')) throw new Error('Destino de lección no permitido.');
  const file = path.resolve(ROOT, target), realRoot = fs.realpathSync(ROOT);
  let ancestor = file;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const real = fs.realpathSync(ancestor);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('El destino sale del repo; abre el proyecto fuente de la skill compartida.');
  if (fs.existsSync(file) && !fs.statSync(file).isFile()) throw new Error('El destino no es un archivo.');
  if (target === rel(LSN_FILE)) throw new Error('Elige el documento de conocimiento, no la lista de propuestas.');
  return file;
}
function lessonGuard(target) {
  lessonPath(target);
  if (!target.startsWith('docs/') && !listChanges().some(c => c.state === 'En desarrollo'))
    throw new Error(`${target} está fuera de docs/: se necesita un CHG En desarrollo antes de preparar o aplicar la propuesta.`);
}
function pendingLesson(key) {
  if (/^CHG-\d+#\d+$/.test(key)) {
    const c = find(key.split('#')[0]), l = chgLessons(c).find(l => l.key === key);
    if (!l) throw new Error(`No existe la lección ${key}.`);
    if (l.target || l.discarded !== null) throw new Error(`${key} ya está decidida.`);
    return { ...l, key, source: rel(c.file), sourceText: c.text };
  }
  const l = commitLessons().find(l => l.id === key);
  if (!l) throw new Error(`No existe ${key}.`);
  if (l.decision !== 'pendiente') throw new Error(`${key} ya está decidida.`);
  return { ...l, key, source: rel(LSN_FILE), sourceText: fs.readFileSync(LSN_FILE, 'utf8') };
}
function findingProposal(target, l, before) {
  const role = BACKLOG_TARGET.exec(target)[1], prefix = BACKLOG_PREFIX[role];
  // El ID de origen permite recuperar una escritura cuyo marcado falló, sin duplicar el hallazgo.
  const existing = before.split(/(?=^### )/m).find(s => s.includes(`Origen: ${l.key}.`));
  if (existing) return { text: before, rule: existing.split('\n')[0], finding: new RegExp(`### (${prefix}-\\d+)`).exec(existing)?.[1] };
  const n = [...before.matchAll(new RegExp(`\\b${prefix}-(\\d{3,})\\b`, 'g'))].reduce((m, x) => Math.max(m, +x[1]), 0) + 1;
  const finding = `${prefix}-${String(n).padStart(3, '0')}`;
  const commits = (/\(commits?:\s*([^)]*)\)/.exec(l.text) || [])[1];
  const rule = l.text.replace(/^LECCI[ÓO]N(?:\([^)]*\))?:\s*/i, '').replace(/^corregir\s*—\s*/i, '').replace(/\s*\(commits?:[^)]*\)/, '').replace(/\s*·\s*destino sugerido:.*$/, '').trim();
  const item = `\n### ${finding} · ${rule.length > 80 ? rule.slice(0, 77) + '…' : rule}
- **Prioridad:** P2
- **Estado:** Abierto
- **Detectado:** ${today()}
- **Evidencia:** ${commits ? `commits ${commits}` : l.source} · ${l.text}
- **Impacto:** ${rule}
- **Solución recomendada:** por definir en el CHG.
- **Verificación:** por definir en el CHG.
- **Historial:** ${today()} — Origen: ${l.key}. Hallazgo registrado; corrección pendiente de CHG aprobado.
`;
  return { text: (before || `# Backlog de ${role.toLowerCase()}\n`).replace(/\s*$/, '\n') + item, rule, finding };
}
function lessonAgent(input) {
  const cfg = loadConfig();
  const base = cfg.panelAgent || cfg.agent;
  const argv = [];
  for (let i = 0; i < base.length; i++) {
    if (['--permission-mode', '--approval-mode'].includes(base[i])) { i++; continue; }
    if (!['--full-auto', '--dangerously-skip-permissions', '--yolo'].includes(base[i])) argv.push(base[i]);
  }
  const prompt = `Prepara la incorporación mínima de una lección al documento destino. NO uses herramientas ni escribas archivos.
Compara con las reglas existentes: no dupliques reglas equivalentes. Si contradice otra regla, devuelve conflicts con la contradicción; no la resuelvas sin decisión del usuario. Una decisión explícita en la lección puede reemplazar la regla anterior.
Devuelve SOLO JSON {"rule":"regla concreta final, contenida literalmente en text","reason":"evidencia y motivo","conflicts":[],"text":"documento completo resultante"}.
Conserva todo el contenido ajeno. Si la regla ya está incorporada, devuelve el documento original y la regla existente en rule. No agregues contenido de producto a una skill general. Si falta el documento, crea un documento mínimo útil con título y regla. No introduzcas reglas ni ejemplos sin evidencia.
INPUT_JSON\n${JSON.stringify(input)}`;
  const r = spawnSync(argv[0], argv.slice(1).map(a => a === '{prompt}' ? prompt : a), {
    cwd: ROOT, encoding: 'utf8', input: argv.includes('{prompt}') ? undefined : prompt,
    shell: process.platform === 'win32', windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) throw new Error(`No se pudo preparar la propuesta: ${r.error?.message || r.stderr || `agente terminó con código ${r.status}`}. La lección sigue pendiente.`);
  let value;
  try { value = JSON.parse(r.stdout.trim().replace(/^```(?:json)?\s*\n|\n```$/g, '')); }
  catch { throw new Error('El agente no devolvió una propuesta JSON válida. La lección sigue pendiente.'); }
  if (!Array.isArray(value.conflicts) || value.conflicts.some(c => typeof c !== 'string') || (typeof value.reason !== 'string' || !value.reason.trim())) throw new Error('Propuesta incompleta.');
  if (value.conflicts.length) return value;
  if (typeof value.text !== 'string' || !value.text.trim() || typeof value.rule !== 'string' || !value.rule.trim() || !value.text.includes(value.rule)) throw new Error('La propuesta no contiene la regla declarada.');
  return value;
}
function lessonDiff(before, after) {
  if (before === after) return '';
  const a = before.split('\n'), b = after.split('\n');
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
  return `@@ -${start + 1},${a.length - start - end} +${start + 1},${b.length - start - end} @@\n`
    + a.slice(start, a.length - end).map(l => '-' + l).concat(b.slice(start, b.length - end).map(l => '+' + l)).join('\n');
}
function previewLesson(key, requested) {
  const l = pendingLesson(key);
  let target = requested.replace(/\\/g, '/');
  // En el repo fuente, no escribir una copia instalada si está disponible el original.
  const skill = /^(?:\.claude\/skills|\.agents\/skills)\/([^/]+)\/SKILL\.md$/.exec(target);
  if (skill && fs.existsSync(path.join(ROOT, 'skills', skill[1], 'SKILL.md'))) target = `skills/${skill[1]}/SKILL.md`;
  lessonGuard(target);
  if (target === l.source) throw new Error('El destino no puede ser el documento de origen.');
  const file = lessonPath(target), existed = fs.existsSync(file), before = existed ? fs.readFileSync(file, 'utf8') : '';
  const finding = BACKLOG_TARGET.test(target);
  if (/^(?:LECCI[ÓO]N(?:\([^)]*\))?:\s*)?corregir\s*—/i.test(l.text) && !finding) throw new Error('Una corrección de código debe dirigirse al backlog del rol y continuar mediante un CHG aprobado.');
  const result = finding ? { ...findingProposal(target, l, before), reason: 'Registrar la evidencia para preparar un CHG; no corrige código.', conflicts: [] }
    : lessonAgent({ lesson: l.text, evidence: l.source, target, before, scope: target.startsWith('skills/') ? 'shared' : 'project' });
  const scope = target.startsWith('skills/') ? 'Compartida: fuente de la skill; afecta a los proyectos que usan esta instalación enlazada. Otras máquinas requieren actualizar el repo fuente; las copias del CLI se distribuyen con team update.'
    : 'Proyecto: solo este repositorio. No cambia otras instalaciones.';
  if (result.conflicts.length) return { key, target, scope, conflicts: result.conflicts, reason: result.reason, blocked: true };
  const proposal = { key, target, scope, rule: result.rule, reason: result.reason, conflicts: [], finding: result.finding || null,
    before, after: result.text, existed, source: l.source, sourceHash: lessonHash(l.sourceText), diff: lessonDiff(before, result.text), duplicate: before === result.text };
  const token = crypto.randomUUID();
  fs.writeFileSync(path.join(lessonPreviewDir(), token + '.json'), JSON.stringify(proposal), { flag: 'wx' });
  return { ...proposal, token };
}
function writeLessonFile(file, text) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function lessonPreviewDir() {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  if (!fs.realpathSync(PREVIEW_DIR).startsWith(fs.realpathSync(ROOT) + path.sep)) throw new Error('La carpeta de propuestas sale del repo.');
  const ignore = path.join(PREVIEW_DIR, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n', { flag: 'wx' });
  return PREVIEW_DIR;
}
function acquireLessonLock(lock) {
  try {
    const fd = fs.openSync(lock, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    return fd;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); } catch (err) {
        if (err.code === 'ESRCH') { fs.unlinkSync(lock); return acquireLessonLock(lock); }
      }
    }
    throw new Error('Otra lección se está aplicando. Reintenta cuando termine.');
  }
}
function acceptLesson(key, target, token) {
  if (!/^[0-9a-f-]{36}$/.test(token || '')) throw new Error('Primero revisa el diff: team lessons preview <lección> <destino>. Luego acepta con --proposal <token>.');
  const proposalFile = path.join(lessonPreviewDir(), token + '.json');
  const p = JSON.parse(fs.readFileSync(proposalFile, 'utf8'));
  if (p.key !== key || p.target !== target) throw new Error('La propuesta no corresponde a la lección y destino elegidos.');
  lessonGuard(p.target);
  const lock = path.join(PREVIEW_DIR, 'apply.lock');
  const fd = acquireLessonLock(lock);
  try {
    const l = pendingLesson(key);
    if (p.source !== l.source || p.sourceHash !== lessonHash(l.sourceText)) throw new Error('La lección cambió desde la propuesta. Prepara y revisa otra propuesta.');
    const file = lessonPath(p.target), exists = fs.existsSync(file), current = exists ? fs.readFileSync(file, 'utf8') : '';
    const applied = exists && current === p.after;
    if (!applied && (exists !== p.existed || current !== p.before)) throw new Error('El documento cambió desde la propuesta. Prepara y revisa otra propuesta; se conserva el trabajo ajeno.');
    if (!p.rule || !p.after.includes(p.rule)) throw new Error('La propuesta no contiene la regla aprobada.');
    if (!applied) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeLessonFile(file, p.after);
    }
    if (fs.readFileSync(lessonPath(p.target), 'utf8') !== p.after) throw new Error('No se pudo verificar la escritura. La lección sigue pendiente.');
    const mark = p.finding ? `${p.target}#${p.finding}` : p.target;
    // Marcar después de verificar. Si falla el marcado, el mismo token recupera la escritura.
    if (/^CHG-/.test(key)) decideChgLesson(key, mark, true);
    else {
      const text = l.sourceText.replace(new RegExp(`^(- ${key} · .+?)[ \\t]*(\\r?)$`, 'm'), (m, a, cr) => `${a} → ${mark}${cr}`);
      if (text === l.sourceText) throw new Error('No se pudo marcar la lección; reintenta con la misma propuesta.');
      writeLessonFile(LSN_FILE, text);
    }
    if (p.finding) out(`✔ ${key} → hallazgo ${p.finding} registrado en ${p.target}. Corrección pendiente de CHG aprobado.`);
    else out(`✔ ${key} incorporada y verificada en ${p.target}${p.duplicate ? ' (regla ya existente)' : ''}.`);
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function decideChgLesson(key, value, accept) {
  const [, num, n] = /^CHG-(\d+)#(\d+)$/.exec(key);
  const c = find(num);
  const l = chgLessons(c)[+n - 1];
  if (!l) fail(`No existe la lección ${key}.`);
  if (l.target || l.discarded !== null) fail(`${key} ya está decidida.`);
  if (accept && !isLessonTarget(value.split('#')[0])) fail('El destino debe ser un lineamiento (docs/*.md), una skill (…/SKILL.md), CLAUDE.md/AGENTS.md/GEMINI.md o docs/backlog/<ROL>.md');
  const mark = accept ? value : `descartada: ${value}`;
  const sec = c.text.search(/^## 9\./m);
  let count = 0;
  const head = c.text.slice(0, sec), body = c.text.slice(sec);
  const updated = body.replace(LESSON_LINE, (m, role, text) => {
    if (/^ninguna\.?$/i.test(text)) return m;
    return ++count === +n ? m.replace(/[ \t]*(\r?)$/, ` → ${mark}$1`) : m;
  });
  writeLessonFile(c.file, head + updated);
  if (!accept) out(`✔ ${key} descartada`);
}
function decideLesson(args, accept) {
  if (accept) {
    const pos = args.indexOf('--proposal');
    const rest = args.filter((a, i) => a !== '--apply' && a !== '--proposal' && !(pos >= 0 && i === pos + 1));
    const key = (rest[0] || '').toUpperCase();
    const target = (rest[1] || '').replace(/\\/g, '/');
    if (rest.length !== 2) fail('Uso: lessons accept <lección> <destino> --proposal <token>');
    try { return acceptLesson(key, target, pos >= 0 ? args[pos + 1] : null); } catch (e) { fail(e.message); }
  }
  const key = (args[0] || '').toUpperCase(), reason = args.slice(1).join(' ').trim();
  if (!reason) fail('Uso: lessons discard LSN-NNN|CHG-NNN#n "motivo"');
  if (/^CHG-\d+#\d+$/.test(key)) return decideChgLesson(key, reason, false);
  try { pendingLesson(key); } catch (e) { fail(e.message); }
  fs.writeFileSync(LSN_FILE, fs.readFileSync(LSN_FILE, 'utf8').replace(new RegExp(`^(- ${key} · .+?)[ \\t]*(\\r?)$`, 'm'), (m, a, cr) => `${a} → descartada: ${reason}${cr}`));
  out(`✔ ${key} descartada`);
}
function lessonsCommand(args = []) {
  if (args[0] === 'preview') {
    try {
      if (!args[1] || !args[2]) throw new Error('Uso: lessons preview LSN-NNN|CHG-NNN#n <destino> [--json]');
      const p = previewLesson(args[1].toUpperCase(), args[2]);
      if (args.includes('--json')) out(JSON.stringify(p));
      else {
        out(`${p.key} → ${p.target}\n${p.scope}\nMotivo: ${p.reason}\nRegla: ${p.rule || '—'}\n${p.conflicts.length ? 'Conflictos: ' + p.conflicts.join('; ') : p.diff || 'La regla ya existe; no se duplicará.'}`);
        if (p.token) out(`\nPara aceptar exactamente esta propuesta:\nteam lessons accept ${p.key} ${p.target} --proposal ${p.token}`);
      }
      return;
    } catch (e) { fail(e.message); }
  }
  if (args[0] === 'accept') return decideLesson(args.slice(1), true);
  if (args[0] === 'discard') return decideLesson(args.slice(1), false);
  if (args.includes('--from-commits')) return fromCommits(args);
  if (!fs.existsSync(BK)) fail('No existe docs/backlog/. Ejecuta primero: team init');
  if (args.includes('--json')) {
    const changes = listChanges().filter(c => c.folder !== 'archived');
    out(JSON.stringify({
      changes: changes.flatMap(c => chgLessons(c).map(l => ({ ...l, id: c.id }))),
      commits: commitLessons(),
      unreviewed: changes.filter(c => lessonsSummary(c).unreviewed).map(c => c.id),
    }, null, 2));
    return;
  }
  const all = listChanges().filter(c => c.folder !== 'archived').map(c => ({ c, ...lessonsSummary(c) }));
  const pending = all.flatMap(x => x.items.filter(l => !l.target).map(l => ({ ...l, id: x.c.id })));
  const unreviewed = all.filter(x => x.unreviewed).map(x => x.c.id);
  const done = all.reduce((s, x) => s + x.items.filter(l => l.target).length, 0);
  out(`Por incorporar: ${pending.length} · Incorporadas: ${done}`);
  pending.forEach(l => out(`  ${l.id}  ${l.role ? `(${l.role}) ` : ''}${l.text}`));
  if (pending.length) out('Al incorporar una, agrega al final de su línea en §9: → docs/ARCHIVO.md');
  if (unreviewed.length) out(`Cerrados sin revisar: ${unreviewed.join(', ')}`);
  const fc = commitLessons();
  if (fc.length) {
    const p = fc.filter(l => l.decision === 'pendiente');
    out(`\nDesde commits: ${p.length} por decidir · ${fc.filter(l => l.decision === 'incorporada').length} incorporadas · ${fc.filter(l => l.decision === 'descartada').length} descartadas`);
    p.forEach(l => out(`  ${l.id}  ${l.text}`));
    if (p.length) out('Revisa: team lessons preview LSN-NNN docs/ARCHIVO.md · team lessons discard LSN-NNN "motivo"');
  }
}
function closedDate(text) {
  const value = /\*\*Cerrado:\*\*[ \t]*(\d{4}-\d{2}-\d{2})(?=\s|$|·)/.exec(text.split(/^## /m)[0])?.[1];
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function snapshot() {
  const base = { project: path.basename(ROOT), root: ROOT, version: VERSION, copyVersion: copyVersion(ROOT) };
  if (!fs.existsSync(BK)) return { ...base, initialized: false, changes: [] };
  return {
    ...base,
    initialized: true,
    changes: listChanges().map(c => ({
      id: c.id, title: c.title, state: c.state, level: c.level, folder: c.folder, model: c.model,
      file: rel(c.file), done: c.done, total: c.total, closedAt: closedDate(c.text),
      tasks: c.tasks.map(t => ({
        id: (/^(T\d+)/.exec(t[2]) || [])[1] || '',
        title: t[2].split('—')[0].replace(/^T\d+\s*·\s*/, '').trim(),
        resp: canonicalRole((/Resp:\s*([^—]+)/.exec(t[2]) || [])[1]?.trim() || ''),
        done: t[1] !== ' ',
      })),
      roles: roles(c),
      lessons: lessonsSummary(c),
      log: (sectionBody(c.text, 8) || '').split(/\r?\n/).filter(l => l.startsWith('- ')).slice(-5).map(l => l.slice(2)),
      next: nextStep(c),
    })),
  };
}
function nextCommand(idArg) {
  if (idArg) { const c = find(idArg); out(`${c.id} · ${c.title} · ${c.state}\n  Sigue: ${nextStep(c) || 'nada; está terminado.'}`); return; }
  if (!fs.existsSync(BK)) fail('No existe docs/backlog/. Ejecuta primero: team init');
  const active = listChanges().filter(c => !['done', 'archived'].includes(c.folder));
  if (!active.length) { out('Nada pendiente.'); return; }
  active.forEach(c => out(`${c.id}  ${c.state.padEnd(16)} ${nextStep(c)}`));
}
function summary() {
  const profile = loadProfile();
  out(`team ${VERSION}${profile?.alias || profile?.nombre ? ` · hola, ${profile.alias || profile.nombre}` : ''}`);
  if (!profile) out('Aún no sabemos cómo llamarte: team profile set alias="…" rol="…" detalle=breve');
  if (!fs.existsSync(BK)) { out('\nEste repo aún no usa el equipo. Para instalarlo: team init'); out('Ver todos los comandos: team help'); return; }
  const all = listChanges();
  const active = all.filter(c => !['done', 'archived'].includes(c.folder));
  const closed = all.filter(c => c.folder === 'done').length;
  out(`${path.basename(ROOT)}: ${active.length} activo(s), ${closed} cerrado(s)`);
  if (!active.length) out('\nNada pendiente. Para empezar: /team quiero …');
  active.forEach(c => out(`\n${c.id}  ${c.level}  ${c.state}  ${c.done}/${c.total}  ${c.title}\n  Sigue: ${nextStep(c)}`));
  outdatedWarning();
  out('\nVer todos los comandos: team help');
}
function help(topic) {
  if (topic === 'flujo' || topic === 'flow') { out(FLOW); return; }
  if (topic && HELP[topic]) { const [u, d, e] = HELP[topic]; out(`${u}\n\n${d}\n\nEjemplo:\n  ${e}`); return; }
  if (topic) out(`Comando desconocido: ${topic}\n`);
  out('team — CLI del equipo de skills   (team <comando>, o node .claude/team.mjs <comando>)\n');
  const groups = [['Instalar y ver', ['init', 'ui', 'status', 'next', 'lessons', 'show', 'help']], ['Crear', ['quick', 'new', 'level']], ['Especificar', ['validate', 'critique', 'approve']], ['Implementar', ['start', 'loop', 'verify', 'reopen']], ['Terminar', ['close', 'archive']], ['Proyectos', ['update', 'projects', 'profile']]];
  for (const [g, cmds] of groups) { out(g); cmds.forEach(k => out(`  ${HELP[k][0].padEnd(52)} ${HELP[k][1].split(/[.:] /)[0].replace(/\.$/, '').slice(0, 70)}`)); out(''); }
  out('Más detalle: help <comando>  ·  Qué usar según la tarea: help flujo');
}

// ---------- comandos ----------
const [cmd, ...args] = process.argv.slice(2);
const needInit = () => { if (!fs.existsSync(BK)) fail('No existe docs/backlog/. Ejecuta primero: node .claude/team.mjs init'); };

switch (cmd) {
  case 'init': init(); break;

  case 'new':
  case 'quick': {
    needInit();
    const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
    const skip = new Set(); ['--level', '--model'].forEach(k => { const i = args.indexOf(k); if (i >= 0) { skip.add(i); skip.add(i + 1); } });
    const title = args.filter((a, i) => !skip.has(i) && !a.startsWith('--')).join(' ').trim();
    if (!title) fail(`Uso: ${cmd} "Título" ${cmd === 'new' ? '[--level S|M|L] ' : ''}[--model perfil]`);
    const level = cmd === 'quick' ? 'XS' : (flag('--level') || 'M').toUpperCase();
    if (cmd === 'new' && !['S', 'M', 'L'].includes(level)) fail('--level debe ser S, M o L (para XS usa quick).');
    const model = flag('--model') || { XS: 'rapido', S: 'estandar', M: 'estandar', L: 'razonamiento' }[level];
    if (cmd === 'quick') {
      const active = listChanges().filter(x => x.state === 'En desarrollo');
      if (active.length && !args.includes('--force')) fail(`Ya hay un cambio En desarrollo: ${active.map(x => x.id).join(', ')}. Termínalo o usa --force.`);
    }
    const num = Math.max(0, ...listChanges().map(c => c.num)) + 1;
    const id = `CHG-${String(num).padStart(3, '0')}`;
    const folder = cmd === 'quick' ? 'in-progress' : 'to-do';
    const dir = path.join(BK, folder, `${id}-${slugify(title)}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CHANGE.md'), cmd === 'quick' ? quickTemplate(id, title, model) : changeTemplate(id, title, level, model));
    syncPlan();
    out(`✔ ${id} (${level}, modelo ${model}) → ${rel(path.join(dir, 'CHANGE.md'))}`);
    if (cmd === 'quick') out(`  Ya está En desarrollo: implementa y luego "close ${id}".`);
    break;
  }

  case 'level': {
    const c = find(args[0]); const lv = (args[1] || '').toUpperCase();
    if (!['S', 'M', 'L'].includes(lv)) fail('Uso: level CHG-NNN S|M|L');
    if (c.folder !== 'to-do') fail('Solo se cambia el nivel en to-do/.');
    let t = c.text.replace(/^\*\*Nivel:\*\*.*$/m, `**Nivel:** ${lv}`);
    t = addHistory(t, `Nivel ${c.level} → ${lv}`);
    save(c, t);
    out(`✔ ${c.id} ahora es nivel ${lv}.` + (lv !== 'S' && c.level === 'S' ? ' Agrega las secciones §2-§6 que falten.' : ''));
    break;
  }

  case 'next': nextCommand(args[0]); break;
  case 'profile': profileCommand(args); break;

  case 'lessons': lessonsCommand(args); break;

  case 'status': {
    if (args.includes('--json')) { out(JSON.stringify(snapshot(), null, 2)); break; }
    needInit();
    const all = listChanges();
    const show = args.includes('--all') ? FOLDERS : FOLDERS.filter(f => f !== 'archived');
    for (const f of show) {
      const items = all.filter(c => c.folder === f);
      out(`\n${f}/ (${items.length})`);
      items.forEach(c => out(`  ${c.id}  ${c.level.padEnd(2)} ${c.state.padEnd(16)} ${String(c.done + '/' + c.total).padEnd(6)} ${c.title}`));
    }
    const bad = all.filter(c => STATES[c.state] !== c.folder);
    if (bad.length) out(`\n⚠ Estado y carpeta no coinciden en: ${bad.map(c => c.id).join(', ')} (ejecuta validate).`);
    syncPlan();
    outdatedWarning();
    break;
  }

  case 'update': update(args); break;

  case 'ui': {
    const panel = path.join(path.dirname(SELF), 'team-ui.mjs');
    if (!fs.existsSync(panel)) fail('El panel solo está en la instalación global. Usa el comando: team ui');
    const { startPanel } = await import(pathToFileURL(panel).href);
    const i = args.indexOf('--port');
    startPanel({ cli: SELF, projects: loadProjects, version: VERSION, port: i >= 0 ? +args[i + 1] : 4599, open: !args.includes('--no-open'), browser: args.includes('--browser'), log: out });
    break;
  }

  case 'projects': projectsCommand(args); break;

  case 'show': { const c = find(args[0]); out(rel(c.file)); out(`${c.id} · ${c.title} · ${c.level} · ${c.state} · modelo ${c.model} · tareas ${c.done}/${c.total}`); c.tasks.filter(t => t[1] === ' ').forEach(t => out(`  [ ] ${t[2].split('—')[0].trim()}`)); break; }

  case 'validate': {
    needInit();
    const list = args[0] ? [find(args[0])] : listChanges().filter(c => c.folder !== 'archived');
    let bad = 0;
    for (const c of list) { const r = validate(c, { forApproval: c.state === 'Borrador' && false }); out(`— ${c.id}`); report(c, r); if (r.errors.length) bad++; }
    if (!list.length) out('No hay cambios.');
    process.exit(bad ? 1 : 0);
  }

  case 'approve': {
    const c = find(args[0]);
    if (c.state !== 'Borrador') fail(`${c.id} está en "${c.state}"; solo se aprueba un Borrador.`);
    const r = validate(c, { forApproval: true });
    if (r.errors.length) { report(c, r); fail(`${c.id} no se puede aprobar todavía.`); }
    let t = setState(c.text, 'Aprobado'); t = setDate(t, 'Aprobado', today()); t = addHistory(t, 'Aprobado por el usuario (Compuerta 2)');
    save(c, t); out(`✔ ${c.id} Aprobado. Siguiente: /developer ${c.id}`);
    r.warnings.forEach(w => out(`⚠ ${w}`));
    break;
  }

  case 'start': {
    const c = find(args[0]);
    if (c.state === 'En desarrollo') { out(`${c.id} ya está En desarrollo.`); break; }
    if (c.state !== 'Aprobado') fail(`${c.id} está en "${c.state}". Solo se inicia un cambio Aprobado (usa /team).`);
    const active = listChanges().filter(x => x.state === 'En desarrollo');
    if (active.length && !args.includes('--force')) fail(`Ya hay un cambio En desarrollo: ${active.map(x => x.id).join(', ')}. Termínalo o usa --force.`);
    let t = setState(c.text, 'En desarrollo'); t = addHistory(t, 'Movido a in-progress/ (En desarrollo)');
    const dir = save(c, t, 'in-progress'); out(`✔ ${c.id} En desarrollo → ${rel(dir)}`);
    break;
  }

  case 'verify': {
    const c = find(args[0]);
    if (c.state !== 'En desarrollo') fail(`${c.id} está en "${c.state}"; debe estar En desarrollo.`);
    const pendingDev = c.tasks.filter(t => t[1] === ' ' && /Resp:\s*(?:developer|dev-implementer)(?=\s*(?:—|$))/i.test(t[2]));
    if (pendingDev.length) fail(`Faltan tareas de developer: ${pendingDev.map(t => (/^(T\d+)/.exec(t[2]) || [])[1]).join(', ')}`);
    let t = setState(c.text, 'En verificación'); t = addHistory(t, 'Implementación terminada → En verificación');
    save(c, t); out(`✔ ${c.id} En verificación. Siguiente: /qa-tester verificación de ${c.id}`);
    break;
  }

  case 'reopen': {
    const c = find(args[0]);
    if (c.state !== 'En verificación') fail(`${c.id} está en "${c.state}"; solo se reabre desde En verificación.`);
    const why = args.slice(1).join(' ') || 'verificación fallida';
    let t = setState(c.text, 'En desarrollo'); t = addHistory(t, `Reabierto: ${why}`);
    save(c, t); out(`✔ ${c.id} vuelve a En desarrollo.`);
    break;
  }

  case 'close': {
    const c = find(args[0]);
    const fi = args.indexOf('--force');
    if (fi !== -1) {
      const why = args.slice(fi + 1).join(' ').trim();
      if (!why) fail('Uso: close CHG-NNN --force "motivo"');
      if (!['Aprobado', 'En desarrollo', 'En verificación'].includes(c.state)) fail(`${c.id} está en "${c.state}"; --force solo cierra cambios Aprobados, En desarrollo o En verificación.`);
      const pending = c.tasks.filter(t => t[1] === ' ');
      let t = c.text.replace(/^- \[ \] (.*)$/gm, (m, line) => /<!--/.test(line) ? m : `- [x] ${line} (cerrada por el usuario sin verificar)`);
      t = setState(t, 'Cerrado'); t = setDate(t, 'Cerrado', today());
      t = addHistory(t, `Cerrado por el usuario sin verificación${pending.length ? ` (pendientes: ${pending.map(x => (/^(T\d+)/.exec(x[2]) || [])[1]).join(', ')})` : ''}: ${why} → done/`);
      const dir = save(c, t, 'done'); out(`✔ ${c.id} Cerrado por el usuario → ${rel(dir)}`);
      if (!lessonsOf(c).declared) out(`⚠ ${c.id} no declara lecciones. Agrega en §9 "LECCIÓN(rol): texto", o "LECCIÓN: ninguna" si no hubo.`);
      break;
    }
    if (!(c.state === 'En verificación' || (c.level === 'XS' && c.state === 'En desarrollo'))) fail(`${c.id} está en "${c.state}"; solo se cierra desde En verificación${c.level === 'XS' ? '' : ' (los XS también desde En desarrollo)'}.`);
    const pending = c.tasks.filter(t => t[1] === ' ');
    if (pending.length) fail(`Tareas sin marcar: ${pending.map(t => (/^(T\d+)/.exec(t[2]) || [])[1]).join(', ')}`);
    let t = setState(c.text, 'Cerrado'); t = setDate(t, 'Cerrado', today()); t = addHistory(t, 'Cerrado por el usuario (Compuerta 3) → done/');
    const dir = save(c, t, 'done'); out(`✔ ${c.id} Cerrado → ${rel(dir)}`);
    if (!lessonsOf(c).declared) out(`⚠ ${c.id} no declara lecciones. Agrega en §9 "LECCIÓN(rol): texto", o "LECCIÓN: ninguna" si no hubo.`);
    break;
  }

  case 'archive': {
    const c = find(args[0]);
    if (c.folder === 'archived') { out(`${c.id} ya está archivado.`); break; }
    const why = args.slice(1).join(' ');
    if (!why) fail('Uso: archive CHG-NNN "motivo"');
    const state = c.state === 'Cerrado' ? 'Archivado' : 'Descartado';
    let t = setState(c.text, state); t = addHistory(t, `${state}: ${why}`);
    const dir = save(c, t, 'archived'); out(`✔ ${c.id} ${state} → ${rel(dir)}`);
    break;
  }

  case 'critique': {
    const c = find(args[0]);
    if (!['Borrador', 'Aprobado'].includes(c.state)) fail(`${c.id} está en "${c.state}"; la crítica es antes de implementar.`);
    const prompt = critiquePrompt(c);
    if (args.includes('--dry-run')) { out(prompt); break; }
    const before = (c.text.match(/CRÍTICO:/g) || []).length;
    const code = runAgent(loadConfig(), prompt);
    if (code !== 0) fail(`El agente terminó con código ${code}.`);
    const after = find(c.id);
    const added = after.text.split('\n').filter(l => l.includes('CRÍTICO:')).slice(before);
    out(added.length ? `\nObservaciones del crítico (${c.id} §9):\n` + added.join('\n') : 'El crítico no agregó observaciones.');
    if (added.some(l => /\?\s*$/.test(l))) out('\nResponde cada pregunta en §9 (agrega "→ decisión" al final de la línea) antes de approve.');
    break;
  }

  case 'loop': {
    const flag = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
    loop(args[0], { batch: flag('--batch'), tries: flag('--tries'), dryRun: args.includes('--dry-run') });
    break;
  }

  case undefined: summary(); break;

  case '--version':
  case '-v':
    out(VERSION);
    break;

  case 'help':
  case '--help':
  case '-h':
    help(args[0]);
    break;

  default:
    help(cmd);
    process.exit(1);
}
