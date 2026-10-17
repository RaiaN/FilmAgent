// Renders every README image to docs/media/<name>.png at 2× (retina).
//   npx electron docs/art/render.js            → all scenes
//   npx electron docs/art/render.js hero shot  → just those
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'media');
const HTML = path.join(__dirname, 'art.html');
const SCENES = fs.readFileSync(path.join(__dirname, 'scenes.js'), 'utf8').match(/^ {2}'?([a-z-]+)'?: \{ size/gm).map((l) => l.trim().split(':')[0].replace(/'/g, ''));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const pick = process.argv.slice(2).filter((a) => SCENES.includes(a));
  const win = new BrowserWindow({ width: 1280, height: 640, show: true, enableLargerThanScreen: true, webPreferences: { zoomFactor: 1, webSecurity: false } }); // local files only: lets art.html import its ES modules over file://
  for (const name of pick.length ? pick : SCENES) {
    await win.loadFile(HTML, { query: { s: name } });
    let size = null;
    for (let i = 0; i < 100 && !size; i += 1) {
      size = await win.webContents.executeJavaScript('window.__ready || null');
      if (!size) await new Promise((r) => setTimeout(r, 50));
    }
    win.setContentSize(size.w, size.h);
    let img = null;
    for (let attempt = 0; attempt < 4 && !img; attempt += 1) {
      await new Promise((r) => setTimeout(r, 400 + attempt * 600));
      img = await win.webContents.capturePage({ x: 0, y: 0, width: size.w, height: size.h }).catch(() => null); // Chromium's capture fails now and then (UnknownVizError); a retry clears it
    }
    if (!img) throw new Error(`could not capture ${name}`);
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
    console.log(name, img.getSize());
  }
  app.quit();
});
