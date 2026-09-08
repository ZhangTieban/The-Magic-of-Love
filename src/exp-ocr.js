import { parseExp } from './exp-log.js';

export function createExpOcr({ root, accept }) {
  const canvas = root.querySelector('[data-exp-preview]');
  const status = root.querySelector('[data-exp-ocr-status]');
  const enabled = root.querySelector('[data-exp-auto]');
  let region = null, worker = null, busy = false, last = 0, revision = 0;
  async function process(source, width, height) {
    if (!enabled.checked || !region || busy || performance.now() - last < 5000) return;
    busy = true;
    last = performance.now();
    const token = revision;
    try {
      const r = region;
      const scale = Math.min(3, 1600 / (r.width * width));
      canvas.width = Math.max(1, Math.round(r.width * width * scale));
      canvas.height = Math.max(1, Math.round(r.height * height * scale));
      canvas.getContext('2d').drawImage(source, r.x * width, r.y * height, r.width * width, r.height * height, 0, 0, canvas.width, canvas.height);
      if (!worker) {
        status.textContent = '載入辨識模型…';
        if (!globalThis.Tesseract) await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
          script.onload = resolve;
          script.onerror = () => { script.remove(); reject(new Error('辨識元件載入失敗，請檢查網路')); };
          document.head.append(script);
        });
        worker = await globalThis.Tesseract.createWorker('eng');
        await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789,.[%]()' });
      }
      const { data } = await worker.recognize(canvas);
      if (token !== revision || !enabled.checked) return;
      const value = parseExp(data.text);
      status.textContent = `讀值：${data.text.trim() || '無'} · 信心 ${Math.round(data.confidence)}%`;
      if (value !== null && data.confidence >= 70) accept(value);
      else status.textContent += ' · 已略過';
    } catch (error) { status.textContent = error.message; enabled.checked = false; }
    finally { busy = false; }
  }
  enabled.onchange = () => { revision++; status.textContent = enabled.checked ? (region ? '等待畫面' : '請框選目前 EXP 數字區域') : '已關閉'; };
  return { process, get region() { return region; }, select(value) { region = value; revision++; status.textContent = '已設定 EXP 範圍'; } };
}
