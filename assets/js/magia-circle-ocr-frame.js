(function startMagiaCircleOcrFrame(global) {
  'use strict';

  const core = global.SpellOcrCore;
  const imageAnalysis = global.ImageAnalysisCore;
  const activeParent = global.parent;
  let activeJobId = null;
  let recognizerPromise = null;
  let textDetectorPromise = null;
  let releaseOcrCvResources = null;
  let ocrCvResourcesTracked = false;
  const ocrCache = global.ModelCache.create({
    name: 'magia-circle-ocr-models-v1',
    onProgress: info => {
      if (info.status === 'cache') notify('控えたOCRモデルを開いています…');
      else if (info.status === 'download') notify('OCRモデルを取得しています…');
      else if (info.status === 'progress') {
        const amount = `${(info.loaded / 1024 / 1024).toFixed(1)} MB`;
        notify(`OCRモデルを取得しています… ${amount}`);
      } else if (info.status === 'done') notify('OCRモデルを準備しています…');
    },
    validate: validateOcrCacheEntry,
  });

  function notify(message) {
    if (activeJobId === null) return;
    activeParent.postMessage({ type: 'progress', jobId: activeJobId, message }, global.location.origin === 'null' ? '*' : global.location.origin);
  }

  function validateOcrCacheEntry(url, response) {
    if (url !== core.config.dictionaryUrl) return true;
    return response.text().then(text => {
      const entries = text.split(/\r?\n/).filter(line => line.trim());
      return entries.length >= 1000 && entries.every(entry => entry.length <= 4);
    });
  }

  function disposeTensors(tensors) {
    for (const tensor of new Set(Object.values(tensors || {}))) {
      try { tensor?.dispose?.(); } catch (error) { console.warn('OCR Tensorを解放できませんでした。', error); }
    }
  }

  function combineSpellLineImages(first, second, firstAngle, secondAngle) {
    return core.combineRgbaLines(first.image, second.image, firstAngle, secondAngle, imageAnalysis.resizeRgbaSharpLinear);
  }

  async function ensureRecognizer() {
    if (recognizerPromise) return recognizerPromise;
    recognizerPromise = (async () => {
      const ort = await import(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/+esm`);
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/dist/`;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      let session;
      try {
        session = await ort.InferenceSession.create(await (await ocrCache.load(core.config.recognitionModelUrl)).arrayBuffer());
        const dictionary = [...(await (await ocrCache.load(core.config.dictionaryUrl)).text()).split('\n'), ' '];
        return { ort, session, dictionary };
      } catch (error) {
        if (session) {
          try { await session.release(); }
          catch (releaseError) { console.warn('OCR認識モデルの初期化失敗後にSessionを解放できませんでした。', releaseError); }
        }
        throw error;
      }
    })();
    recognizerPromise.catch(() => { recognizerPromise = null; });
    return recognizerPromise;
  }

  async function releaseOcrModels(detector) {
    let recognizer = null;
    if (recognizerPromise) {
      try { recognizer = await recognizerPromise; }
      catch (error) { console.warn('OCR認識モデルの準備に失敗しました。', error); }
    }
    const resources = [...new Set([detector, recognizer?.session].filter(Boolean))];
    let releaseError = null;
    for (const resource of resources) {
      try { await resource.release(); }
      catch (error) {
        releaseError ||= error;
        console.warn('OCRモデルのONNX Sessionを解放できませんでした。', error);
      }
    }
    textDetectorPromise = null;
    recognizerPromise = null;
    if (releaseError) throw releaseError;
  }

  async function recognizeCanvas(canvas, inferPixelSpaces) {
    const { ort, session, dictionary } = await ensureRecognizer();
    const height = 48;
    const width = Math.max(48, Math.min(960, Math.round(canvas.width / Math.max(1, canvas.height) * height)));
    let resized = imageAnalysis.resizeRgbaSharpLinear(canvas.data, canvas.width, canvas.height, width, height);
    const pixels = width * height;
    let values = new Float32Array(pixels * 3);
    for (let index = 0; index < pixels; index += 1) {
      const offset = index * 4;
      values[index] = resized[offset + 2] / 255;
      values[pixels + index] = resized[offset + 1] / 255;
      values[pixels * 2 + index] = resized[offset] / 255;
    }
    resized = null;
    const input = new ort.Tensor('float32', values, [1, 3, height, width]);
    values = null;
    let outputs;
    try {
      outputs = await session.run({ [session.inputNames[0]]: input });
      const output = outputs[session.outputNames[0]];
      const decoded = core.decodeGreedyCtcDetailed(output, dictionary);
      return inferPixelSpaces
        ? { text: decoded.text, spacingText: core.insertSpacesAtPixelGaps(canvas, decoded) }
        : decoded.text;
    } finally {
      disposeTensors({ input });
      disposeTensors(outputs);
    }
  }

  async function recognizeBrowserLineVariants(line) {
    const isRingLine = String(line.groupId || '').startsWith('ring:');
    return core.runRecognizeVariants({
      source: line.image,
      preprocess: (source, mode) => core.preprocessRgba(source, mode),
      rotate: core.rotateRgba,
      recognize: image => recognizeCanvas(image, isRingLine),
    });
  }

  async function ensureTextDetector() {
    if (textDetectorPromise) return textDetectorPromise;
    textDetectorPromise = (async () => {
      const cvModule = await import('https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.3/+esm');
      const importedCv = cvModule.default ?? cvModule;
      const cv = importedCv instanceof Promise ? await importedCv : importedCv;
      if (!cv.Mat) await new Promise(resolve => {
        const previous = cv.onRuntimeInitialized;
        cv.onRuntimeInitialized = () => { previous?.(); resolve(); };
      });
      if (!ocrCvResourcesTracked) {
        const cvResources = new Set();
        const trackCvResource = resource => {
          if (!resource || typeof resource.delete !== 'function' || cvResources.has(resource)) return resource;
          const dispose = resource.delete;
          try {
            resource.delete = function (...args) {
              cvResources.delete(resource);
              return dispose.apply(this, args);
            };
            cvResources.add(resource);
          } catch {}
          return resource;
        };
        const trackConstructor = name => {
          const Constructor = cv[name];
          if (typeof Constructor !== 'function') return;
          cv[name] = new Proxy(Constructor, {
            construct(target, args) { return trackCvResource(Reflect.construct(target, args, target)); },
          });
        };
        for (const name of ['Mat', 'MatVector', 'Point', 'Size', 'Scalar']) trackConstructor(name);
        const matVectorGet = cv.MatVector?.prototype?.get;
        if (matVectorGet) cv.MatVector.prototype.get = function (...args) { return trackCvResource(matVectorGet.apply(this, args)); };
        for (const name of ['matFromArray', 'getRotationMatrix2D', 'minAreaRect']) {
          const factory = cv[name];
          if (typeof factory === 'function') cv[name] = function (...args) { return trackCvResource(factory.apply(cv, args)); };
        }
        const getPerspectiveTransform = cv.getPerspectiveTransform;
        if (typeof getPerspectiveTransform === 'function') {
          let warnedAboutPerspectiveBinding = false;
          cv.getPerspectiveTransform = function (source, destination, ...options) {
            try { return trackCvResource(getPerspectiveTransform.call(cv, source, destination, ...options)); }
            catch (error) {
              if (!(error instanceof TypeError) || !/hasOwnProperty/.test(error.message || '')) throw error;
              if (!warnedAboutPerspectiveBinding) {
                console.warn('OpenCV getPerspectiveTransform overload is unavailable; using an equivalent four-point transform solver.');
                warnedAboutPerspectiveBinding = true;
              }
              const sourcePoints = Array.from(source.data32F || []);
              const destinationPoints = Array.from(destination.data32F || []);
              if (sourcePoints.length < 8 || destinationPoints.length < 8) throw error;
              const equations = [];
              const values = [];
              for (let index = 0; index < 4; index += 1) {
                const x = sourcePoints[index * 2];
                const y = sourcePoints[index * 2 + 1];
                const u = destinationPoints[index * 2];
                const v = destinationPoints[index * 2 + 1];
                if (![x, y, u, v].every(Number.isFinite)) throw error;
                equations.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
                values.push(u);
                equations.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
                values.push(v);
              }
              const augmented = equations.map((row, index) => [...row, values[index]]);
              for (let column = 0; column < 8; column += 1) {
                let pivot = column;
                for (let row = column + 1; row < 8; row += 1) {
                  if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
                }
                if (Math.abs(augmented[pivot][column]) < 1e-12) throw error;
                [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
                const divisor = augmented[column][column];
                for (let cell = column; cell <= 8; cell += 1) augmented[column][cell] /= divisor;
                for (let row = 0; row < 8; row += 1) {
                  if (row === column) continue;
                  const factor = augmented[row][column];
                  for (let cell = column; cell <= 8; cell += 1) augmented[row][cell] -= factor * augmented[column][cell];
                }
              }
              const coefficients = augmented.map(row => row[8]);
              if (!coefficients.every(Number.isFinite)) throw error;
              const transform = new cv.Mat(3, 3, cv.CV_64F);
              transform.data64F.set([...coefficients, 1]);
              return transform;
            }
          };
        }
        releaseOcrCvResources = () => {
          for (const resource of [...cvResources].reverse()) {
            try { resource.delete(); } catch { cvResources.delete(resource); }
          }
          cvResources.clear();
        };
        ocrCvResourcesTracked = true;
      }
      cv.matFromImageData = imageData => {
        const data = imageData instanceof ImageData
          ? imageData
          : new ImageData(Uint8ClampedArray.from(imageData.data), imageData.width, imageData.height);
        const mat = new cv.Mat(data.height, data.width, cv.CV_8UC4);
        mat.data.set(data.data);
        return mat;
      };
      const splitSource = await (await fetch('https://cdn.jsdelivr.net/npm/@gutenye/ocr-common@1.4.9/splitIntoLineImages/+esm')).text();
      const support = String.raw`class BrowserLineImage {
  constructor({data,width,height}) { this.data=Uint8ClampedArray.from(data); this.width=width; this.height=height; }
  async resize(size,heightValue) {
    const requestedWidth=Number(typeof size==='object'?size?.width:size);
    const requestedHeight=Number(typeof size==='object'?size?.height:heightValue);
    const width=Math.max(1,Math.round(Number.isFinite(requestedWidth)?requestedWidth:this.width));
    const height=Math.max(1,Math.round(Number.isFinite(requestedHeight)?requestedHeight:this.height));
    const source=document.createElement('canvas'); source.width=this.width; source.height=this.height;
    source.getContext('2d').putImageData(new ImageData(this.data,this.width,this.height),0,0);
    const target=document.createElement('canvas'); target.width=width; target.height=height;
    try {
      target.getContext('2d').drawImage(source,0,0,width,height);
      return new BrowserLineImage(target.getContext('2d').getImageData(0,0,width,height));
    } finally {
      source.width=1; source.height=1;
      target.width=1; target.height=1;
    }
  }
}`;
      const patchedSource = support + splitSource
        .replace('from"/npm/@techstark/opencv-js@4.9.0-release.3/+esm"', 'from"https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.3/+esm"')
        .replace('from"/npm/js-clipper@1.0.1/+esm"', 'from"https://cdn.jsdelivr.net/npm/js-clipper@1.0.1/+esm"')
        .replace('let v;', 'let v=BrowserLineImage;');
      const splitUrl = URL.createObjectURL(new Blob([patchedSource], { type: 'text/javascript' }));
      let splitModule;
      try { splitModule = await import(splitUrl); }
      finally { URL.revokeObjectURL(splitUrl); }
      const { splitIntoLineImages } = splitModule;
      const ort = await import(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/+esm`);
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/dist/`;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const detectionSession = await ort.InferenceSession.create(await (await ocrCache.load(core.config.detectionModelUrl)).arrayBuffer());
      return {
        async release() { await detectionSession.release(); },
        async detect(source) {
          let image;
          let inputImage;
          let outputImage;
          let input;
          let outputs;
          try {
            image = await BrowserImageRaw.open(source);
            const width = Math.max(32, Math.ceil(image.width / 32) * 32);
            const height = Math.max(32, Math.ceil(image.height / 32) * 32);
            inputImage = width === image.width && height === image.height
              ? image
              : await image.resize({ width, height });
            const pixels = inputImage.width * inputImage.height;
            let values = new Float32Array(pixels * 3);
            for (let index = 0; index < pixels; index += 1) {
              const offset = index * 4;
              values[index] = inputImage.data[offset + 2] / 255;
              values[pixels + index] = inputImage.data[offset + 1] / 255;
              values[pixels * 2 + index] = inputImage.data[offset] / 255;
            }
            input = new ort.Tensor('float32', values, [1, 3, inputImage.height, inputImage.width]);
            values = null;
            outputs = await detectionSession.run({ [detectionSession.inputNames[0]]: input });
            disposeTensors({ input });
            input = null;
            const modelOutput = outputs[detectionSession.outputNames[0]];
            const outputHeight = modelOutput.dims[2];
            const outputWidth = modelOutput.dims[3];
            const data = new Uint8ClampedArray(outputWidth * outputHeight * 4);
            for (let index = 0; index < modelOutput.data.length; index += 1) {
              const value = modelOutput.data[index] > 0.03 ? 255 : 0;
              const offset = index * 4;
              data[offset] = data[offset + 1] = data[offset + 2] = value;
              data[offset + 3] = 255;
            }
            outputImage = new BrowserImageRaw({ data, width: outputWidth, height: outputHeight });
            disposeTensors(outputs);
            outputs = null;
            const lineImages = await splitIntoLineImages(outputImage, inputImage);
            return { lineImages, resizedImageWidth: inputImage.width, resizedImageHeight: inputImage.height };
          } finally {
            disposeTensors(outputs);
            disposeTensors({ input });
            if (image) image.data = new Uint8ClampedArray(0);
            if (inputImage) inputImage.data = new Uint8ClampedArray(0);
            if (outputImage) outputImage.data = new Uint8ClampedArray(0);
            releaseOcrCvResources?.();
          }
        },
      };
    })();
    textDetectorPromise.catch(() => { textDetectorPromise = null; });
    return textDetectorPromise;
  }

  class BrowserImageRaw {
    constructor({ data, width, height }) {
      this.data = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
      this.width = width;
      this.height = height;
    }
    async resize({ width, height }) {
      return new BrowserImageRaw({ data: imageAnalysis.resizeRgbaSharpContain(this.data, this.width, this.height, width, height), width, height });
    }
    async write() {}
    async drawBox() { return this; }
    static async open(source) {
      if (source?.data && source.width && source.height) return new BrowserImageRaw(source);
      if (source instanceof HTMLCanvasElement) {
        return new BrowserImageRaw(source.getContext('2d').getImageData(0, 0, source.width, source.height));
      }
      const image = new Image();
      let canvas;
      try {
        image.src = source;
        await image.decode();
        canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        return new BrowserImageRaw(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
      } finally {
        if (canvas) { canvas.width = 1; canvas.height = 1; }
        image.removeAttribute('src');
      }
    }
  }

  async function recognize({ buffer, width, height }) {
    let sourcePixels = { data: new Uint8ClampedArray(buffer), width, height };
    let detector;
    try {
      detector = await ensureTextDetector();
      notify('画像の文字と環を読み取っています…');
      return await core.run({
        detect: async () => {
          const detected = await detector.detect(sourcePixels);
          const lineImages = detected.lineImages || [];
          const additionalLineImages = lineImages.length <= 8
            ? function* () { yield* core.iterateRingSectors(sourcePixels); }
            : null;
          return { ...detected, lineImages, additionalLineImages };
        },
        recognizeVariants: recognizeBrowserLineVariants,
        combineLines: combineSpellLineImages,
        vocabularyCorrector: null,
        releaseLinePixelsAfterRecognition: true,
      });
    } finally {
      try { if (detector) await releaseOcrModels(detector); }
      finally {
        if (sourcePixels) sourcePixels.data = new Uint8ClampedArray(0);
        sourcePixels = null;
      }
    }
  }

  global.addEventListener('message', async event => {
    if (event.source !== activeParent || event.origin !== global.location.origin) return;
    const message = event.data || {};
    if (message.type !== 'recognize' || !Number.isInteger(message.jobId)) return;
    activeJobId = message.jobId;
    try {
      const result = await recognize(message);
      activeParent.postMessage({ type: 'success', jobId: activeJobId, result }, global.location.origin === 'null' ? '*' : global.location.origin);
    } catch (error) {
      activeParent.postMessage({ type: 'error', jobId: activeJobId, message: error?.message || String(error) }, global.location.origin === 'null' ? '*' : global.location.origin);
    } finally {
      activeJobId = null;
    }
  });
})(globalThis);
