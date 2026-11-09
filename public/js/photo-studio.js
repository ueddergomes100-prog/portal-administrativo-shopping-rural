// Estúdio de foto do produto: tira o fundo, centraliza o produto num quadrado branco sempre do mesmo
// tamanho e salva em WebP — todas as fotos do site ficam padronizadas.
//
// O recorte usa o U²-Net pequeno (u2netp, licença Apache 2.0, ~4,6 MB em /assets/models), o mesmo do
// rembg, rodando no próprio navegador com o onnxruntime-web (MIT). Não paga por foto e a imagem não
// sai do aparelho. Na primeira foto o navegador baixa o modelo e o motor (~16 MB); depois fica em cache.
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
const MODEL_URL = '/assets/models/u2netp.onnx';
const SIZE = 1200;          // lado do quadrado final, em px
const MARGIN = 0.08;        // respiro em volta do produto (8% de cada lado)
const MAX_SOURCE = 2000;    // fotos maiores são reduzidas antes de recortar
const NET = 320;            // entrada do modelo
const EDGE_LOW = 90;        // abaixo disso (0–255) a máscara vira fundo
const EDGE_HIGH = 200;      // acima disso vira produto
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

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
  const mask = new ImageData(NET, NET);
  for (let p = 0; p < plane; p++) {
    const v = Math.round(((pred[p] - lo) / range) * 255);
    mask.data[p * 4] = mask.data[p * 4 + 1] = mask.data[p * 4 + 2] = v;
    mask.data[p * 4 + 3] = 255;
  }
  return mask;
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

// Foto que já veio com fundo transparente (PNG recortado): não precisa do modelo.
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

// Prepara uma foto de produto. Devolve { blob, removed } — `removed` diz se o fundo foi tirado
// (se o recorte falhar, a foto ainda sai padronizada, só que com o fundo original).
export async function prepareProductPhoto(file, { removeBackground = true } = {}) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`${file.name || 'Imagem'}: não é uma imagem que o navegador consiga abrir.`);
  const scale = Math.min(1, MAX_SOURCE / Math.max(bitmap.width, bitmap.height));
  const source = canvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  source.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, source.width, source.height);

  let cut = source;
  let removed = false;
  if (hasTransparentCorners(source)) {
    removed = true;
  } else if (removeBackground) {
    try {
      cut = applyMask(source, await productMask(source));
      removed = true;
    } catch (error) {
      console.warn('[foto] recorte falhou, segue sem tirar o fundo:', error);
      cut = source;
    }
  }
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
  return { blob: await toBlob(out), removed };
}
