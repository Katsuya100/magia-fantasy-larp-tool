importScripts('spell-ocr.js', 'image-analysis-core.js', 'model-cache.js', 'ocr-line-split.js');

(function startMagiaCircleOcrWorker(global) {
  'use strict';

  const core = global.SpellOcrCore;
  const imageAnalysis = global.ImageAnalysisCore;
  let activeJobId = null;
  let activeAbortController = null;
  let recognizerPromise = null;
  let textDetectorPromise = null;
  let releaseOcrCvResources = null;
  let ocrCvResourcesTracked = false;
  let activeDetectionLineResources = null;
  let diagnosticsMode = false;
  const runtimeDefaults = core.config.onnxRuntimeDefaults;
  const ocrSessionOptions = Object.freeze({
    executionMode: runtimeDefaults.executionMode,
    enableCpuMemArena: runtimeDefaults.enableCpuMemArena,
    enableMemPattern: runtimeDefaults.enableMemPattern,
  });
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
    global.postMessage({ type: 'progress', jobId: activeJobId, message });
  }

  function reportStage(stage, memory = null) {
    if (activeJobId === null) return;
    global.postMessage({
      type: 'stage',
      jobId: activeJobId,
      stage,
      ...(diagnosticsMode && memory ? { memory } : {}),
    });
  }

  function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error(signal.reason?.message || 'OCR was cancelled.');
    error.name = 'AbortError';
    throw error;
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
    try {
      return core.combineRgbaLines(first.image, second.image, firstAngle, secondAngle, imageAnalysis.resizeRgbaSharpLinear);
    } finally {
      first.image?.release?.();
      second.image?.release?.();
    }
  }

  async function ensureRecognizer() {
    if (recognizerPromise) return recognizerPromise;
    recognizerPromise = (async () => {
      const ort = await import(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/+esm`);
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/dist/`;
      ort.env.wasm.numThreads = runtimeDefaults.numThreads;
      ort.env.wasm.proxy = false;
      let session;
      try {
        session = await ort.InferenceSession.create(
          await (await ocrCache.load(core.config.recognitionModelUrl)).arrayBuffer(),
          { ...ocrSessionOptions },
        );
        const dictionary = [...(await (await ocrCache.load(core.config.dictionaryUrl)).text()).split('\n'), ' '];
        return { ort, session, dictionary };
      } catch (error) {
        if (session) {
          try { await session.release(); }
          catch (releaseError) { console.warn('OCR認識モデルの初期化失敗後にSessionを解放できませんでした。', releaseError); }
          session = null;
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
    for (let index = 0; index < resources.length; index += 1) {
      const resource = resources[index];
      try { await resource.release(); }
      catch (error) {
        releaseError ||= error;
        console.warn('OCRモデルのONNX Sessionを解放できませんでした。', error);
      } finally {
        if (resource === detector) detector = null;
        if (recognizer?.session === resource) recognizer.session = null;
        resources[index] = null;
      }
    }
    resources.length = 0;
    recognizer = null;
    textDetectorPromise = null;
    recognizerPromise = null;
    if (releaseError) throw releaseError;
  }

  async function releaseTextDetector(detector) {
    textDetectorPromise = null;
    await detector?.release();
  }

  async function recognizeCanvas(canvas, inferPixelSpaces, signal) {
    const { ort, session, dictionary } = await ensureRecognizer();
    throwIfAborted(signal);
    const height = 48;
    const width = Math.max(48, Math.min(960, Math.round(canvas.width / Math.max(1, canvas.height) * height)));
    let resized = null;
    let values = null;
    let input;
    let outputs;
    try {
      resized = imageAnalysis.resizeRgbaSharpLinear(canvas.data, canvas.width, canvas.height, width, height);
      const pixels = width * height;
      values = new Float32Array(pixels * 3);
      for (let index = 0; index < pixels; index += 1) {
        const offset = index * 4;
        values[index] = resized[offset + 2] / 255;
        values[pixels + index] = resized[offset + 1] / 255;
        values[pixels * 2 + index] = resized[offset] / 255;
      }
      input = new ort.Tensor('float32', values, [1, 3, height, width]);
      values = null;
      resized = null;
      outputs = await session.run({ [session.inputNames[0]]: input });
      throwIfAborted(signal);
      const output = outputs[session.outputNames[0]];
      const decoded = core.decodeGreedyCtcDetailed(output, dictionary);
      return inferPixelSpaces
        ? { text: decoded.text, spacingText: core.insertSpacesAtPixelGaps(canvas, decoded) }
        : decoded.text;
    } finally {
      disposeTensors({ input });
      disposeTensors(outputs);
      values = null;
      resized = null;
    }
  }

  async function recognizeBrowserLineVariants(line) {
    const isRingLine = String(line.groupId || '').startsWith('ring:');
    return core.runRecognizeVariants({
      source: line.image,
      preprocess: (source, mode) => core.preprocessRgba(source, mode),
      rotate: core.rotateRgba,
      recognize: image => recognizeCanvas(image, isRingLine, activeAbortController?.signal),
      signal: activeAbortController?.signal,
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
      const clipperModule = await import('https://cdn.jsdelivr.net/npm/js-clipper@1.0.1/+esm');
      const clipper = clipperModule.default ?? clipperModule;
      const ort = await import(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/+esm`);
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/dist/`;
      ort.env.wasm.numThreads = runtimeDefaults.numThreads;
      ort.env.wasm.proxy = false;
      let detectionSession = null;
      let detectionModel = null;
      try {
        detectionModel = await (await ocrCache.load(core.config.detectionModelUrl)).arrayBuffer();
        reportStage('ocr-detection-session-create');
        detectionSession = await ort.InferenceSession.create(
          detectionModel,
          { ...ocrSessionOptions },
        );
        detectionModel = null;
      } catch (error) {
        if (detectionSession) {
          try { await detectionSession.release(); }
          finally { detectionSession = null; }
        }
        throw error;
      } finally {
        detectionModel = null;
      }
      reportStage('ocr-detection-session-ready');
      reportStage('ocr-runtime-ready');
      const releaseDetectionSession = async () => {
        if (!detectionSession) return;
        const session = detectionSession;
        detectionSession = null;
        await session.release();
      };
      return {
        async release() { await releaseDetectionSession(); },
        async detect(source, signal) {
          if (!detectionSession) throw new Error('OCR検出モデルはすでに解放されています。');
          let image = null;
          let inputValues = null;
          let inputTensor = null;
          let outputs = null;
          let modelOutput = null;
          let mask = null;
          let lineResources = null;
          let sessionForRun = detectionSession;
          let memory = null;
          let completed = false;
          try {
            throwIfAborted(signal);
            image = await BrowserImageRaw.open(source);
            const width = Math.max(32, Math.ceil(image.width / 32) * 32);
            const height = Math.max(32, Math.ceil(image.height / 32) * 32);
            memory = {
              ocrInputWidth: image.width,
              ocrInputHeight: image.height,
              detectionTensorWidth: width,
              detectionTensorHeight: height,
              inputFloat32EstimatedBytes: width * height * 3 * Float32Array.BYTES_PER_ELEMENT,
            };

            reportStage('ocr-detection-input-start', memory);
            inputValues = imageAnalysis.resizeRgbaSharpContainToPlanarFloat32(image.data, image.width, image.height, width, height);
            inputTensor = new ort.Tensor('float32', inputValues, [1, 3, height, width]);
            inputValues = null;
            reportStage('ocr-detection-input-ready', memory);
            throwIfAborted(signal);
            reportStage('ocr-detection-run-start', memory);
            outputs = await sessionForRun.run({ [sessionForRun.inputNames[0]]: inputTensor });
            reportStage('ocr-detection-run-done', memory);
            throwIfAborted(signal);

            modelOutput = outputs[sessionForRun.outputNames[0]];
            const outputHeight = modelOutput.dims[2];
            const outputWidth = modelOutput.dims[3];
            memory.detectionMaskWidth = outputWidth;
            memory.detectionMaskHeight = outputHeight;
            memory.maskEstimatedBytes = outputWidth * outputHeight * Uint8Array.BYTES_PER_ELEMENT;
            reportStage('ocr-detection-mask-start', memory);
            mask = new Uint8Array(outputWidth * outputHeight);
            for (let index = 0; index < modelOutput.data.length; index += 1) {
              mask[index] = modelOutput.data[index] > 0.03 ? 255 : 0;
            }
            reportStage('ocr-detection-mask-ready', memory);

            disposeTensors(outputs);
            outputs = null;
            modelOutput = null;
            reportStage('ocr-detection-output-disposed', memory);
            disposeTensors({ input: inputTensor });
            inputTensor = null;
            inputValues = null;
            await releaseDetectionSession();
            sessionForRun = null;
            reportStage('ocr-detection-session-release', memory);

            reportStage('ocr-detection-opencv-start', memory);
            lineResources = global.MagiaOcrLineSplitter.create(cv, clipper, mask, outputWidth, outputHeight, image, width, height, () => { mask = null; });
            activeDetectionLineResources = lineResources;
            mask = null;
            reportStage('ocr-detection-opencv-done', memory);
            completed = true;
            return { lineImages: lineResources.lines, resizedImageWidth: width, resizedImageHeight: height };
          } finally {
            try {
              disposeTensors(outputs);
              outputs = null;
              modelOutput = null;
              disposeTensors({ input: inputTensor });
              inputTensor = null;
              inputValues = null;
              mask = null;
              if (detectionSession) {
                await releaseDetectionSession();
                sessionForRun = null;
                reportStage('ocr-detection-session-release', memory);
              }
              if (lineResources && lineResources !== activeDetectionLineResources) lineResources.release();
              image = null;
            } finally {
              reportStage('ocr-detection-cleanup', memory);
              if (completed) reportStage('ocr-detection-done', memory);
            }
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
    async write() {}
    async drawBox() { return this; }
    static async open(source) {
      if (source?.data && source.width && source.height) return new BrowserImageRaw(source);
      throw new TypeError('OCR Worker requires a transferred RGBA buffer.');
    }
  }

  async function recognize({ buffer, width, height, signal }) {
    let sourcePixels = { data: new Uint8ClampedArray(buffer), width, height };
    let detector;
    const releaseSourcePixels = () => {
      if (sourcePixels) sourcePixels.data = new Uint8ClampedArray(0);
      sourcePixels = null;
    };
    try {
      throwIfAborted(signal);
      reportStage('ocr-runtime-loading');
      detector = await ensureTextDetector();
      throwIfAborted(signal);
      notify('画像の文字と環を読み取っています…');
      const result = await core.run({
        detect: async () => {
          reportStage('ocr-detection-start');
          const detected = await detector.detect(sourcePixels, signal);
          const lineImages = detected.lineImages || [];
          const additionalLineImages = lineImages.length <= 8
            ? function* () {
                try { yield* core.iterateRingSectors(sourcePixels); }
                finally { releaseSourcePixels(); }
              }
            : null;
          if (!additionalLineImages) releaseSourcePixels();
          // Detection is complete; do not keep its ONNX session beside the recognizer session.
          await releaseTextDetector(detector);
          detector = null;
          reportStage('ocr-recognition-start');
          return { ...detected, lineImages, additionalLineImages };
        },
        recognizeVariants: recognizeBrowserLineVariants,
        combineLines: combineSpellLineImages,
        vocabularyCorrector: null,
        releaseLinePixelsAfterRecognition: true,
        signal,
      });
      reportStage('ocr-recognition-done');
      return result;
    } finally {
      reportStage('ocr-cleanup-start');
      try { await releaseOcrModels(detector); }
      finally {
        try { activeDetectionLineResources?.release(); }
        finally {
          activeDetectionLineResources = null;
          try { releaseOcrCvResources?.(); }
          finally {
            releaseOcrCvResources = null;
            releaseSourcePixels();
          }
        }
      }
    }
  }

  global.addEventListener('message', event => {
    const message = event.data || {};
    if (message.type === 'abort' && message.jobId === activeJobId) {
      const error = new Error('OCR was cancelled.');
      error.name = 'AbortError';
      activeAbortController?.abort(error);
      return;
    }
    if (message.type !== 'analyze' || !Number.isInteger(message.jobId) || activeJobId !== null) return;
    activeJobId = message.jobId;
    diagnosticsMode = Boolean(message.diagnostics);
    activeAbortController = new AbortController();
    void (async () => {
      try {
        const result = await recognize({ ...message, signal: activeAbortController.signal });
        global.postMessage({ type: 'success', jobId: activeJobId, result });
      } catch (error) {
        global.postMessage({ type: 'error', jobId: activeJobId, name: error?.name || 'Error', message: error?.message || String(error) });
      } finally {
        message.buffer = null;
        activeAbortController = null;
        activeJobId = null;
        diagnosticsMode = false;
      }
    })();
  });
})(globalThis);
