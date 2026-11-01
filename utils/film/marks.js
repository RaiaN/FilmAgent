// DRAWN MARKS: freehand red strokes over a picture say where an edit applies. Points are 0..1 of the
// picture, so they fit whatever size it shows at. Canvas and FilmAgent draw and bake them the same way.
export const MARK_COLOR = '#ff2d2d';

export const drawStrokes = (g, strokes, width, height, lineWidth = 3) => {
  g.strokeStyle = MARK_COLOR;
  g.lineWidth = lineWidth;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  strokes.forEach((pts) => {
    g.beginPath();
    pts.forEach((pt, i) => (i ? g.lineTo(pt.x * width, pt.y * height) : g.moveTo(pt.x * width, pt.y * height)));
    g.stroke();
  });
};

// A copy of the picture with the marks on it, at full size. Null if the picture can't be read.
export const bakeMarks = (src, strokes) => new Promise((resolve) => {
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth;
      c.height = im.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(im, 0, 0);
      drawStrokes(g, strokes, c.width, c.height, Math.max(4, Math.round(c.width * 0.005)));
      resolve(c.toDataURL('image/jpeg', 0.92));
    } catch { resolve(null); }
  };
  im.onerror = () => resolve(null);
  im.src = src;
});
