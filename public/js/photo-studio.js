// Estúdio de foto do produto: tira o fundo, centraliza o produto num quadrado branco sempre do mesmo
// tamanho e salva em WebP — todas as fotos do site ficam padronizadas.
//
// Dois jeitos de tirar o fundo, escolhidos foto a foto:
// 1. Fundo liso (o comum em foto de fornecedor/site: produto no branco ou numa cor só) — o fundo é
//    achado pela cor da borda da foto e "pintado" a partir das beiradas, parando no contorno do produto.
//    Nada que esteja dentro do contorno some, mesmo as partes brancas da embalagem. Não usa IA.
// 2. Fundo bagunçado (foto tirada na loja) — usa o U²-Net pequeno (u2netp, licença Apache 2.0,
//    ~4,6 MB em /assets/models), o mesmo do rembg, rodando no próprio navegador com o onnxruntime-web
//    (MIT). Os buracos que ele abrir no meio do produto são fechados depois.
// Nos dois casos a foto não sai do aparelho e não se paga nada por foto. Se mesmo assim cortar
// errado, a tela oferece "Desfazer recorte" (a foto original fica guardada até recarregar a página).
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
const MODEL_URL = '/assets/models/u2netp.onnx';
const SIZE = 1200;          // lado do quadrado final, em px
const MARGIN = 0.08;        // respiro em volta do produto (8% de cada lado)
const MAX_SOURCE = 1600;    // fotos maiores são reduzidas antes de recortar
const NET = 320;            // entrada do modelo
const EDGE_LOW = 90;        // abaixo disso (0–255) a máscara vira fundo
const EDGE_HIGH = 200;      // acima disso vira produto
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
// Fundo liso: a cor mais comum da borda cobre boa parte dela. Quase branco basta menos, porque o
// produto costuma encostar nas beiradas em foto bem fechada.
const PLAIN_SHARE = 0.7;
const WHITE_SHARE = 0.35;
const NEAR = 40;            // distância de cor (0–441) para contar como "a mesma cor" da borda
const MIN_PIECE = 0.02;     // pedaços menores que 2% do maior (marca d'água, sujeira) saem

const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Não foi possível carregar a ferramenta que tira o fundo. Confira a internet.'));
    document.head.append(s);
  });
}

let sessionPromise = null;
function session() {
  sessionPromise ??= (async () => {
    if (!window.ort) await loadScript(ORT_BASE + 'ort.min.js');
    window.ort.env.wasm.wasmPaths = ORT_BASE;
    window.ort.env.wasm.numThreads = 1; // sem SharedArrayBuffer: funciona em qualquer navegador
    return window.ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
  })().catch(error => { sessionPromise = null; throw error; });
  return sessionPromise;
}

// ---------- 1. Fundo liso: pela cor da borda ----------

// Olha a faixa da borda da foto. Se uma cor domina, devolve { color, tol }; senão null.
function plainBackground(data, w, h) {
  if (w < 16 || h < 16) return null;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.015));
  const bins = new Map();
  const border = [];
  for (let y = 0; y < h; y++) {
    const edgeRow = y < band || y >= h - band;
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x === band) x = w - band; // pula o miolo da linha
      const i = (y * w + x) * 4;
      border.push(i);
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      bins.set(key, (bins.get(key) || 0) + 1);
    }
  }
  let topKey = -1, topCount = 0;
  for (const [key, count] of bins) if (count > topCount) { topKey = key; topCount = count; }
  const sum = [0, 0, 0];
  let n = 0;
  for (const i of border) {
    if ((((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)) !== topKey) continue;
    sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; n++;
  }
  const color = sum.map(v => v / n);
  const near = [];
  for (const i of border) {
    const d = Math.hypot(data[i] - color[0], data[i + 1] - color[1], data[i + 2] - color[2]);
    if (d <= NEAR) near.push(d);
  }
  const share = near.length / border.length;
  const white = Math.min(...color) >= 225;
  if (share < (white ? WHITE_SHARE : PLAIN_SHARE)) return null;
  near.sort((a, b) => a - b);
  const p95 = near[Math.floor(near.length * 0.95)] || 0;
  // Tolerância pelo "chuvisco" do próprio fundo (JPEG, degradê leve), dentro de limites seguros.
  return { color, tol: Math.min(45, Math.max(18, p95 * 1.5 + 10)) };
}

// Pinta o fundo a partir das beiradas (só passa por pixels da cor do fundo) e devolve a foto
// com o fundo transparente. Devolve null se quase nada sobrou (aí tenta a IA).
function colorCut(source, ctx, img, bg) {
  const { width: w, height: h } = source;
  const data = img.data;
  const n = w * h;
  const [br, bgG, bb] = bg.color;
  const tol2 = bg.tol * bg.tol;
  const dist2 = p => { const i = p * 4; const r = data[i] - br, g = data[i + 1] - bgG, b = data[i + 2] - bb; return r * r + g * g + b * b; };

  // Fundo = alcançável a partir das beiradas passando só pela cor do fundo.
  const isBg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  const seed = p => { if (!isBg[p] && dist2(p) <= tol2) { isBg[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (top) {
    const p = stack[--top];
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }

  // Pedaços do produto (o que não é fundo). Buracos fechados por dentro continuam produto.
  const label = new Int32Array(n); // 0 = sem pedaço
  const sizes = [0];
  for (let start = 0; start < n; start++) {
    if (isBg[start] || label[start]) continue;
    const id = sizes.length;
    let size = 0;
    label[start] = id; stack[top++] = start;
    while (top) {
      const p = stack[--top];
      size++;
      const x = p % w;
      if (x > 0 && !isBg[p - 1] && !label[p - 1]) { label[p - 1] = id; stack[top++] = p - 1; }
      if (x < w - 1 && !isBg[p + 1] && !label[p + 1]) { label[p + 1] = id; stack[top++] = p + 1; }
      if (p >= w && !isBg[p - w] && !label[p - w]) { label[p - w] = id; stack[top++] = p - w; }
      if (p < n - w && !isBg[p + w] && !label[p + w]) { label[p + w] = id; stack[top++] = p + w; }
    }
    sizes.push(size);
  }
  let largest = 0;
  for (const size of sizes) if (size > largest) largest = size; // (sem spread: podem ser milhares de pedaços)
  if (largest < n * 0.003) return null;
  const keep = sizes.map(size => size >= largest * MIN_PIECE);

  // Transparência: fundo some; no contorno, uma transição curta pela distância da cor do fundo
  // (tira a franja da cor antiga quando o fundo não é branco).
  for (let p = 0; p < n; p++) {
    const i = p * 4 + 3;
    if (isBg[p] || !keep[label[p]]) { data[i] = 0; continue; }
    const x = p % w;
    const edge = (x > 0 && isBg[p - 1]) || (x < w - 1 && isBg[p + 1]) || (p >= w && isBg[p - w]) || (p < n - w && isBg[p + w]);
    if (edge) data[i] = Math.min(data[i], Math.round(255 * Math.min(1, Math.max(0.3, (Math.sqrt(dist2(p)) - bg.tol) / (bg.tol * 1.5)))));
  }
  const out = canvas(w, h);
  out.getContext('2d').putImageData(img, 0, 0);
  return out;
}

// ---------- 2. Fundo bagunçado: IA ----------

// Máscara do produto (0–255) em NET×NET, com o mesmo pré e pós-processamento do rembg.
async function productMask(source) {
  const s = await session();
  const small = canvas(NET, NET).getContext('2d', { willReadFrequently: true });
  small.drawImage(source, 0, 0, NET, NET);
  const { data } = small.getImageData(0, 0, NET, NET);
  let max = 1;
  for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i], data[i + 1], data[i + 2]);
  const plane = NET * NET;
  const input = new Float32Array(3 * plane);
  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    for (let ch = 0; ch < 3; ch++) input[ch * plane + p] = (data[i + ch] / max - MEAN[ch]) / STD[ch];
  }
  const out = await s.run({ [s.inputNames[0]]: new window.ort.Tensor('float32', input, [1, 3, NET, NET]) });
  const pred = out[s.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (let p = 0; p < plane; p++) { if (pred[p] < lo) lo = pred[p]; if (pred[p] > hi) hi = pred[p]; }
  const range = hi - lo || 1;
  const values = new Uint8ClampedArray(plane);
  for (let p = 0; p < plane; p++) values[p] = Math.round(((pred[p] - lo) / range) * 255);
  fillHoles(values);
  const mask = new ImageData(NET, NET);
  for (let p = 0; p < plane; p++) {
    mask.data[p * 4] = mask.data[p * 4 + 1] = mask.data[p * 4 + 2] = values[p];
    mask.data[p * 4 + 3] = 255;
  }
  return mask;
}

// A IA às vezes "fura" o produto (parte branca da caixa, rótulo claro). Todo buraco cercado de
// produto por todos os lados volta a ser produto: só é fundo o que encosta nas beiradas.
function fillHoles(values) {
  const n = NET * NET;
  const outside = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  const seed = p => { if (!outside[p] && values[p] < 128) { outside[p] = 1; stack[top++] = p; } };
  for (let k = 0; k < NET; k++) { seed(k); seed((NET - 1) * NET + k); seed(k * NET); seed(k * NET + NET - 1); }
  while (top) {
    const p = stack[--top];
    const x = p % NET;
    if (x > 0) seed(p - 1);
    if (x < NET - 1) seed(p + 1);
    if (p >= NET) seed(p - NET);
    if (p < n - NET) seed(p + NET);
  }
  for (let p = 0; p < n; p++) if (!outside[p] && values[p] < 128) values[p] = 255;
}

// Aplica a máscara como transparência na foto (no tamanho da foto).
function applyMask(source, mask) {
  const { width: w, height: h } = source;
  const m = canvas(NET, NET);
  m.getContext('2d').putImageData(mask, 0, 0);
  const scaled = canvas(w, h).getContext('2d', { willReadFrequently: true });
  scaled.imageSmoothingQuality = 'high';
  scaled.drawImage(m, 0, 0, w, h);
  const alpha = scaled.getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  // Contorno firme: o que o modelo marcou com pouca certeza (borda borrada, sombra fraca) some, e o
  // meio-termo vira uma transição curta — sem auréola do fundo antigo em volta do produto.
  for (let i = 3; i < img.data.length; i += 4) {
    const a = alpha[i - 3];
    const v = a <= EDGE_LOW ? 0 : a >= EDGE_HIGH ? 255 : Math.round(((a - EDGE_LOW) * 255) / (EDGE_HIGH - EDGE_LOW));
    img.data[i] = Math.min(img.data[i], v);
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

// ---------- Montagem ----------

// Retângulo onde está o produto (pixels não transparentes); null se não achou nada.
function productBox(cut) {
  const { width: w, height: h } = cut;
  const { data } = cut.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Foto que já veio com fundo transparente (PNG recortado): não precisa recortar.
function hasTransparentCorners(source) {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = source;
  return [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].every(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] < 250);
}

function toBlob(c) {
  return new Promise(resolve => c.toBlob(blob => {
    // Navegador sem WebP (Safari antigo): JPEG, que o fundo é branco mesmo.
    if (blob?.type === 'image/webp') resolve(blob);
    else c.toBlob(resolve, 'image/jpeg', 0.9);
  }, 'image/webp', 0.86));
}

// Tira o fundo: primeiro pela cor (fundo liso), senão pela IA. Devolve { cut, method } ou null.
async function removeBackgroundOf(source) {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, source.width, source.height);
  const bg = plainBackground(img.data, source.width, source.height);
  if (bg) {
    const cut = colorCut(source, ctx, img, bg);
    if (cut) return { cut, method: 'cor' };
  }
  try {
    return { cut: applyMask(source, await productMask(source)), method: 'ia' };
  } catch (error) {
    console.warn('[foto] recorte falhou, segue sem tirar o fundo:', error);
    return null;
  }
}

// Prepara uma foto de produto. Devolve { blob, removed, method } — `removed` diz se o fundo foi
// tirado e `method` como ('cor', 'ia' ou 'png'). Sem tirar o fundo (ou se o recorte falhar), a foto
// ainda sai padronizada: inteira, centralizada no quadrado branco.
export async function prepareProductPhoto(file, { removeBackground = true } = {}) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`${file.name || 'Imagem'}: não é uma imagem que o navegador consiga abrir.`);
  const scale = Math.min(1, MAX_SOURCE / Math.max(bitmap.width, bitmap.height));
  const source = canvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  source.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, source.width, source.height);

  let cut = source;
  let method = null;
  if (hasTransparentCorners(source)) {
    method = 'png';
  } else if (removeBackground) {
    const result = await removeBackgroundOf(source);
    if (result) ({ cut, method } = result);
  }
  const removed = !!method;
  const box = (removed && productBox(cut)) || { x: 0, y: 0, w: cut.width, h: cut.height };

  const out = canvas(SIZE, SIZE);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const room = SIZE * (1 - 2 * MARGIN);
  const fit = Math.min(room / box.w, room / box.h, 3); // não estica mais que 3× foto muito pequena
  const w = box.w * fit, h = box.h * fit;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cut, box.x, box.y, box.w, box.h, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  return { blob: await toBlob(out), removed, method };
}

// Arquivo pronto para enviar, com o nome da foto original e a extensão certa.
export const photoFile = (blob, original) =>
  new File([blob], `${(original?.name || 'foto').replace(/\.[^.]+$/, '')}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type });

// O recorte foi feito agora (pela cor ou pela IA) e dá para voltar à foto inteira.
export const canUndoCut = method => method === 'cor' || method === 'ia';

// Fotos originais das que tiveram o fundo tirado nesta página, para o "Desfazer recorte".
// Ficam só na memória do navegador (somem ao recarregar).
const originals = new Map();
export const rememberOriginal = (ref, file) => { originals.set(ref, file); };
export const originalOf = ref => originals.get(ref) || null;
export const forgetOriginal = ref => { originals.delete(ref); };
