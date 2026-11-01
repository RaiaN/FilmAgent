#!/usr/bin/env node
// The film tools from a terminal, for an agent or a person, against the running dev server.
//   node scripts/film.mjs list
//   node scripts/film.mjs create_project '{"name":"Test"}'
//   node scripts/film.mjs add_media '{"project":"film-x","label":"her face"}' --file face.jpg
//   node scripts/film.mjs look '{"project":"film-x","name":"T1"}' --save frames/
import fs from 'fs';
import path from 'path';

const BASE = process.env.FILM_TOOLS_URL || 'http://localhost:3000';
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };

const [, , tool, ...rest] = process.argv;
const option = (flag) => { const i = rest.indexOf(flag); return i >= 0 ? rest.splice(i, 2)[1] : null; };
const file = option('--file');
const save = option('--save');
const args = rest[0] ? JSON.parse(rest[0]) : {};

if (!tool || tool === 'list') {
  const { tools } = await (await fetch(`${BASE}/api/film/tools`)).json();
  tools.forEach((t) => console.log(`${t.name}: ${t.description}`));
  process.exit(0);
}
if (file) {
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) { console.error(`Can't tell what ${file} is. Types: ${Object.keys(TYPES).join(' ')}`); process.exit(1); }
  args.data_url = `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
}
const res = await fetch(`${BASE}/api/film/tools`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, args }) });
const out = await res.json();
if (!res.ok) { console.error(out.error); process.exit(1); }
if (save && (out.frames || out.image_url)) {
  fs.mkdirSync(save, { recursive: true });
  const pictures = out.frames ? out.frames.map((f) => ({ url: f.url, name: `${out.name}-${String(f.t).replace('.', '_')}s.jpg` })) : [{ url: out.image_url, name: `${out.name}.jpg` }];
  await Promise.all(pictures.map(async ({ url, name }) => {
    const bytes = Buffer.from(await (await fetch(url.startsWith('/') ? BASE + url : url)).arrayBuffer());
    fs.writeFileSync(path.join(save, name), bytes);
  }));
  out.saved = pictures.map((p) => path.join(save, p.name));
}
console.log(JSON.stringify(out, null, 1));
