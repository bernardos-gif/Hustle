// Built-in 5x7 pixel font (no external assets, works offline). Glyphs are rasterised once per
// colour into tiny canvases and drawn with nearest-neighbour scaling, so text is always crisp.

const G: Record<string, string> = {
  A: '.###.#...##...#######...##...##...#',
  B: '####.#...##...#####.#...##...#####.',
  C: '.###.#...##....#....#....#...#.###.',
  D: '####.#...##...##...##...##...#####.',
  E: '######....#....####.#....#....#####',
  F: '######....#....####.#....#....#....',
  G: '.###.#...##....#.####...##...#.###.',
  H: '#...##...##...#######...##...##...#',
  I: '.###...#....#....#....#....#...###.',
  J: '..###...#....#....#....#.#..#..##..',
  K: '#...##..#.#.#..##...#.#..#..#.#...#',
  L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#',
  N: '#...##...###..##.#.##..###...##...#',
  O: '.###.#...##...##...##...##...#.###.',
  P: '####.#...##...#####.#....#....#....',
  Q: '.###.#...##...##...##.#.##..#..##.#',
  R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.#####....#.....###.....#....#####.',
  T: '#####..#....#....#....#....#....#..',
  U: '#...##...##...##...##...##...#.###.',
  V: '#...##...##...##...##...#.#.#...#..',
  W: '#...##...##...##.#.##.#.##.#.#.#.#.',
  X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..',
  Z: '#####....#...#...#...#...#....#####',
  '0': '.###.#...##..###.#.###..##...#.###.',
  '1': '..#...##....#....#....#....#...###.',
  '2': '.###.#...#....#...#...#...#...#####',
  '3': '####.....#....#.###.....#....#####.',
  '4': '...#...##..#.#.#..#.#####...#....#.',
  '5': '######....####.....#....##...#.###.',
  '6': '..##..#...#....####.#...##...#.###.',
  '7': '#####....#...#...#...#....#....#...',
  '8': '.###.#...##...#.###.#...##...#.###.',
  '9': '.###.#...##...#.####....#...#..##..',
  '.': '.........................##...##...',
  ',': '....................##....#...#....',
  ':': '......##...##.........##...##......',
  ';': '......##...##.........##....#...#..',
  '!': '..#....#....#....#....#.........#..',
  '?': '.###.#...#....#...#...#.........#..',
  '-': '...............#####...............',
  '+': '.......#....#..#####..#....#.......',
  '/': '....#....#...#...#...#...#....#....',
  '(': '...#...#...#....#....#.....#.....#.',
  ')': '.#.....#.....#....#....#...#...#...',
  '[': '.###..#....#....#....#....#....###.',
  ']': '.###....#....#....#....#....#..###.',
  "'": '..#....#...#........................',
  '"': '.#.#..#.#..........................',
  '%': '##..###..#...#...#...#...#..###..##',
  '#': '.#.#..#.#.#####.#.#.#####.#.#..#.#.',
  '&': '.##..#..#.#.#...#...#.#.##..#..##.#',
  '*': '.....#.#.#.###.#####.###.#.#.#.....',
  '<': '...#...#...#...#.....#.....#.....#.',
  '>': '.#.....#.....#.....#...#...#...#...',
  '=': '..........#####.....#####..........',
  _: '..............................#####',
  '|': '..#....#....#....#....#....#....#..',
  '^': '..#...#.#.#...#....................',
  '~': '...........##.##.##................',
  '@': '.###.#...##.####.#.##.####.....###.',
  $: '..#...####.#....###....#.####...#..',
  '◀': '...#...##..###.####..###...##....#.',
  '▶': '.#....##...###..####.###..##...#...',
  '▲': '.......#...###.#####...............',
  '▼': '...............#####.###...#.......',
  '■': '.....##########.#########..........',
  '□': '.....######...##...######..........',
  '●': '......###.#####.#####.###..........',
  '·': '.................#.................',
  '•': '...........###..###..###...........',
  '→': '.......#.....#.#####...#...#.......',
  '←': '.......#...#...#####.#.....#.......',
  '×': '.....#...#.#.#...#...#.#.#...#.....',
  '∞': '..........#.#.#.#.#.#.#............',
  '❚': '.#.#..#.#..#.#..#.#..#.#..#.#..#.#.',
  ' ': '...................................',
};
const ALIAS: Record<string, string> = { '—': '-', '–': '-', '…': '.', 'é': 'E', '°': '·', '’': "'", '‘': "'", '“': '"', '”': '"', '½': '/' };

interface Glyph {
  rows: boolean[][];
  left: number;
  width: number;
}

const glyphs = new Map<string, Glyph>();
function glyph(ch: string): Glyph {
  let g = glyphs.get(ch);
  if (g) return g;
  let key = ch.toUpperCase();
  if (!G[key]) key = ALIAS[ch] ?? ALIAS[key] ?? '?';
  const src = G[key].padEnd(35, '.');
  const rows: boolean[][] = [];
  for (let r = 0; r < 7; r++) rows.push([...src.slice(r * 5, r * 5 + 5)].map((c) => c === '#'));
  let left = 5;
  let right = -1;
  for (const row of rows) row.forEach((on, i) => on && ((left = Math.min(left, i)), (right = Math.max(right, i))));
  if (right < 0) {
    left = 0;
    right = key === ' ' ? 2 : 0;
  }
  g = { rows, left, width: right - left + 1 };
  glyphs.set(ch, g);
  return g;
}

const bitmaps = new Map<string, HTMLCanvasElement>();
function bitmap(ch: string, color: string): HTMLCanvasElement {
  const k = ch + color;
  let c = bitmaps.get(k);
  if (c) return c;
  const g = glyph(ch);
  c = document.createElement('canvas');
  c.width = 5;
  c.height = 7;
  const x = c.getContext('2d')!;
  x.fillStyle = color;
  g.rows.forEach((row, r) => row.forEach((on, i) => on && x.fillRect(i, r, 1, 1)));
  if (bitmaps.size > 4000) bitmaps.clear();
  bitmaps.set(k, c);
  return c;
}

/** Width in pixels of `text` at integer `scale`. */
export function textWidth(text: string, scale = 2): number {
  let w = 0;
  for (const ch of text) w += (glyph(ch).width + 1) * scale;
  return Math.max(0, w - scale);
}

export interface TextOpts {
  scale?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  shadow?: string | null;
  /** Vertical anchor: 'top' (default) or 'middle' or 'baseline' (bottom of glyph). */
  valign?: 'top' | 'middle' | 'baseline';
  alpha?: number;
  shadowOffset?: number;
}

/** Draws pixel text in screen space. Returns the drawn width. */
export function pixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextOpts = {}): number {
  const s = Math.max(1, Math.round(o.scale ?? 2));
  const color = o.color ?? '#ffffff';
  const w = textWidth(text, s);
  let px = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
  let py = o.valign === 'middle' ? y - (7 * s) / 2 : o.valign === 'baseline' ? y - 7 * s : y;
  px = Math.round(px);
  py = Math.round(py);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  const shadow = o.shadow === undefined ? '#0b0718' : o.shadow;
  // big text gets a proportionally smaller drop shadow so it doesn't look doubled
  const so = o.shadowOffset ?? (s <= 3 ? s : Math.max(3, Math.round(s * 0.35)));
  const passes: [string, number][] = shadow ? [[shadow, so], [color, 0]] : [[color, 0]];
  for (const [col, off] of passes) {
    let cx = px;
    for (const ch of text) {
      const g = glyph(ch);
      if (ch !== ' ') ctx.drawImage(bitmap(ch, col), g.left, 0, g.width, 7, cx + off, py + off, g.width * s, 7 * s);
      cx += (g.width + 1) * s;
    }
  }
  ctx.restore();
  return w;
}

/** Splits text into lines no wider than maxWidth pixels at the given scale. */
export function wrapPixel(text: string, maxWidth: number, scale = 2): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (textWidth(t, scale) > maxWidth && line) {
      out.push(line);
      line = word;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}
