importScripts('runtime-dependencies.js', 'analysis-diagnostics.js', 'ocr-error-policy.js', 'ocr-resource-tracker.js', 'spell-ocr.js', 'image-analysis-core.js', 'model-cache.js', 'ocr-line-split.js');

(function startMagiaCircleOcrWorker(global) {
  'use strict';

  const core = global.SpellOcrCore;
  const dependencies = global.MagiaRuntimeDependencies;
  const imageAnalysis = global.ImageAnalysisCore;
  let activeJobId = null;
  let activeAbortController = null;
  let recognizerPromise = null;
  let textDetectorPromise = null;
  let ocrCvResourceTracker = null;
  let releaseOcrCvResources = null;
  const cleanupErrorAggregator = global.MagiaOcrResourceTracker.createCleanupErrorAggregator(
    (cleanupError, details) => {
      try { reportStage('ocr-cleanup-error', { ...details, cleanupError }); }
      catch (reportError) { console.warn('OCR cleanup failure could not be recorded in diagnostics.', reportError); }
    },
    summary => {
      try {
        const { stage, ...details } = summary;
        reportStage(stage, details);
      } catch (reportError) { console.warn('OCR cleanup summary could not be recorded in diagnostics.', reportError); }
    },
  );
  const runtimeDefaults = core.config.onnxRuntimeDefaults;
  // OCR uses only WASM. The +esm browser bundle also loads the larger JSEP
  // runtime, increasing memory during each short-lived Worker initialization.
  const ocrRuntimeUrl = dependencies.onnxRuntimeUrl;
  const diagnosticReporter = global.MagiaAnalysisDiagnostics.createReporter('ocr', message => {
    if (activeJobId !== null) global.postMessage({ ...message, jobId: activeJobId });
  });
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

  function reportStage(stage, details = {}) {
    if (activeJobId === null) return;
    diagnosticReporter.stage(stage, {
      onnxRuntimeVersion: core.config.onnxRuntimeWebVersion,
      graphOptimizationLevel: runtimeDefaults.graphOptimizationLevel,
      numThreads: runtimeDefaults.numThreads,
      ...details,
    });
  }

  function reportRuntimeState(name, value) {
    reportStage(`ocr-runtime-state-${name}`, { runtimeState: { [name]: Boolean(value) } });
  }

  function reportCleanupError(resourceType, error, details = {}) {
    const firstOccurrence = cleanupErrorAggregator.record(resourceType, error, details) === 1;
    if (firstOccurrence) console.warn(`OCR ${resourceType} cleanup failed.`, error);
  }

  async function loadOcrResource(resource, loader) {
    try { return await loader(); }
    catch (error) {
      const wrapped = global.MagiaOcrErrorPolicy.wrapRetryableLoadFailure(error, resource);
      if (wrapped !== error) reportStage('ocr-resource-load-retryable-error', {
        resource, error: { name: wrapped.name, code: wrapped.code, message: wrapped.message.slice(0, 240) },
      });
      throw wrapped;
    }
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

  function disposeTensors(tensors, details = {}) {
    for (const tensor of new Set(Object.values(tensors || {}))) {
      try { tensor?.dispose?.(); }
      catch (error) { reportCleanupError('tensor-dispose', error, details); }
    }
  }

  function releaseLineImage(image, details = {}) {
    try { image?.release?.(); }
    catch (error) { reportCleanupError('line-image-release', error, details); }
  }

  function combineSpellLineImages(first, second, firstAngle, secondAngle) {
    try {
      return core.combineRgbaLines(first.image, second.image, firstAngle, secondAngle, imageAnalysis.resizeRgbaSharpLinear, diagnosticReporter);
    } finally {
      releaseLineImage(first.image, { lineIndex: first.index });
      releaseLineImage(second.image, { lineIndex: second.index });
    }
  }

  async function ensureRecognizer(lineInfo = {}) {
    if (recognizerPromise) return recognizerPromise;
    reportStage('ocr-recognition-runtime-ensure-start', lineInfo);
    recognizerPromise = (async () => {
      reportStage('ocr-recognition-ort-import-start', lineInfo);
      const ort = await loadOcrResource('recognition ONNX Runtime module', () => import(ocrRuntimeUrl));
      reportStage('ocr-recognition-ort-import-done', { ...lineInfo, version: ort.env.versions?.web || core.config.onnxRuntimeWebVersion });
      ort.env.wasm.wasmPaths = dependencies.onnxRuntimeWasmPath;
      ort.env.wasm.numThreads = runtimeDefaults.numThreads;
      ort.env.wasm.proxy = false;
      let session;
      let modelBytes = null;
      let modelTracked = false;
      try {
        reportStage('ocr-recognition-model-fetch-start', { ...lineInfo, url: core.config.recognitionModelUrl });
        const modelResponse = await loadOcrResource('recognition model', () => ocrCache.load(core.config.recognitionModelUrl));
        reportStage('ocr-recognition-model-fetch-done', { ...lineInfo, contentLength: Number(modelResponse.headers?.get('content-length')) || null });
        const estimatedModelBytes = Number(modelResponse.headers?.get('content-length')) || 0;
        diagnosticReporter.allocationStart('ocr-recognition-model-buffer-start', 'recognition-model-buffer', estimatedModelBytes, {
          type: 'ArrayBuffer', name: 'Recognition model bytes', countedInKnownLive: true,
        });
        modelBytes = await loadOcrResource('recognition model response body', () => modelResponse.arrayBuffer());
        diagnosticReporter.allocationDone('ocr-recognition-model-buffer-done', 'recognition-model-buffer', modelBytes.byteLength, {
          type: 'ArrayBuffer', name: 'Recognition model bytes', width: null, height: null,
        });
        modelTracked = true;
        reportStage('ocr-recognition-session-create-start', { ...lineInfo, modelBytes: modelBytes.byteLength, sessionOptions: ocrSessionOptions });
        reportStage('ocr-recognition-wasm-runtime-init-start', { ...lineInfo, numThreads: runtimeDefaults.numThreads, runtimeUrl: ocrRuntimeUrl });
        session = await ort.InferenceSession.create(modelBytes, { ...ocrSessionOptions });
        reportStage('ocr-recognition-session-create-done', { ...lineInfo, modelBytes: modelBytes.byteLength, runtimeState: { recognizerLoaded: true } });
        reportStage('ocr-recognition-wasm-runtime-init-done', { ...lineInfo, version: ort.env.versions?.web || core.config.onnxRuntimeWebVersion });
        diagnosticReporter.releaseStart('ocr-recognition-model-buffer-release-start', 'recognition-model-buffer', { type: 'ArrayBuffer' });
        modelBytes = null;
        diagnosticReporter.releaseDone('ocr-recognition-model-buffer-release-done', 'recognition-model-buffer');
        modelTracked = false;
        reportStage('ocr-recognition-dictionary-fetch-start', lineInfo);
        const dictionaryResponse = await loadOcrResource('recognition dictionary', () => ocrCache.load(core.config.dictionaryUrl));
        reportStage('ocr-recognition-dictionary-fetch-done', lineInfo);
        reportStage('ocr-recognition-dictionary-text-start', lineInfo);
        const dictionaryText = await loadOcrResource('recognition dictionary response body', () => dictionaryResponse.text());
        reportStage('ocr-recognition-dictionary-text-done', { ...lineInfo, textLength: dictionaryText.length });
        const dictionary = [...dictionaryText.split('\n'), ' '];
        reportStage('ocr-recognition-runtime-ensure-done', lineInfo);
        return { ort, session, dictionary };
      } catch (error) {
        if (session) {
          try { await session.release(); }
          catch (releaseError) { reportCleanupError('recognition-session-release', releaseError, { reason: 'initialization-failed' }); }
          session = null;
        }
        if (modelTracked) diagnosticReporter.releaseDone('ocr-recognition-model-buffer-release-done', 'recognition-model-buffer', { reason: 'session-create-failed' });
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
    for (let index = 0; index < resources.length; index += 1) {
      const resource = resources[index];
      const isRecognizer = resource === recognizer?.session;
      if (isRecognizer) reportStage('ocr-recognition-session-release-start');
      try {
        await resource.release();
        if (isRecognizer) reportStage('ocr-recognition-session-release-done', { runtimeState: { recognizerLoaded: false } });
      }
      catch (error) {
        reportCleanupError(isRecognizer ? 'recognition-session-release' : 'detection-session-release', error);
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
  }

  async function recognizeCanvas(canvas, inferPixelSpaces, signal, lineInfo = {}) {
    const { lineIndex = null, lineCount = null, angle = null, variant = null } = lineInfo;
    const context = { lineIndex, lineCount, angle, variant };
    diagnosticReporter.updateContext(context);
    const { ort, session, dictionary } = await ensureRecognizer(context);
    throwIfAborted(signal);
    const height = 48;
    const width = Math.max(48, Math.min(960, Math.round(canvas.width / Math.max(1, canvas.height) * height)));
    const resizedBytes = canvas.width === width && canvas.height === height ? canvas.width * canvas.height * 4 : width * height * 4;
    const inputBytes = width * height * 3 * Float32Array.BYTES_PER_ELEMENT;
    const resizedId = `recognition-resized-${lineIndex}-${variant}-${angle}`;
    const inputId = `recognition-input-${lineIndex}-${variant}-${angle}`;
    let resized = null;
    let values = null;
    let input;
    let outputs;
    try {
      reportStage('ocr-recognition-resize-start', { ...context, sourceWidth: canvas.width, sourceHeight: canvas.height, width, height, estimatedBytes: resizedBytes });
      diagnosticReporter.allocationStart('ocr-recognition-resize-buffer-alloc-start', resizedId, resizedBytes, {
        name: 'Recognition resized RGBA', width, height, type: 'Uint8ClampedArray',
      });
      resized = imageAnalysis.resizeRgbaSharpLinear(canvas.data, canvas.width, canvas.height, width, height);
      diagnosticReporter.allocationDone('ocr-recognition-resize-buffer-alloc-done', resizedId, resized.byteLength, {
        name: 'Recognition resized RGBA', width, height, type: 'Uint8ClampedArray',
      });
      reportStage('ocr-recognition-resize-done', { ...context, width, height });
      const pixels = width * height;
      diagnosticReporter.allocationStart('ocr-recognition-input-buffer-alloc-start', inputId, inputBytes, {
        name: 'Recognition Float32 RGB input', width, height, type: 'Float32Array', tensorShape: [1, 3, height, width],
      });
      values = new Float32Array(pixels * 3);
      diagnosticReporter.allocationDone('ocr-recognition-input-buffer-alloc-done', inputId, values.byteLength, {
        name: 'Recognition Float32 RGB input', width, height, type: 'Float32Array', tensorShape: [1, 3, height, width],
      });
      reportStage('ocr-recognition-input-fill-start', { ...context, width, height, estimatedBytes: inputBytes });
      for (let index = 0; index < pixels; index += 1) {
        const offset = index * 4;
        values[index] = resized[offset + 2] / 255;
        values[pixels + index] = resized[offset + 1] / 255;
        values[pixels * 2 + index] = resized[offset] / 255;
      }
      reportStage('ocr-recognition-input-fill-done', { ...context, width, height, estimatedBytes: inputBytes });
      diagnosticReporter.releaseStart('ocr-recognition-resize-buffer-release-start', resizedId, { ...context });
      resized = null;
      diagnosticReporter.releaseDone('ocr-recognition-resize-buffer-release-done', resizedId, { ...context });
      reportStage('ocr-recognition-tensor-create-start', { ...context, tensorShape: [1, 3, height, width], inputEstimatedBytes: inputBytes });
      input = new ort.Tensor('float32', values, [1, 3, height, width]);
      reportStage('ocr-recognition-tensor-create-done', { ...context, tensorShape: [1, 3, height, width], inputEstimatedBytes: inputBytes });
      values = null;
      resized = null;
      reportStage('ocr-recognition-run-start', {
        ...context, tensorShape: [1, 3, height, width], inputEstimatedBytes: inputBytes,
        knownLiveBytes: diagnosticReporter.knownLiveBytes,
      });
      outputs = await session.run({ [session.inputNames[0]]: input });
      reportStage('ocr-recognition-run-done', { ...context, tensorShape: [1, 3, height, width] });
      throwIfAborted(signal);
      reportStage('ocr-recognition-output-decode-start', { ...context });
      const output = outputs[session.outputNames[0]];
      const decoded = core.decodeGreedyCtcDetailed(output, dictionary);
      const recognized = inferPixelSpaces
        ? { text: decoded.text, spacingText: core.insertSpacesAtPixelGaps(canvas, decoded) }
        : decoded.text;
      reportStage('ocr-recognition-output-decode-done', { ...context, outputShape: output?.dims ? [...output.dims] : null });
      return recognized;
    } finally {
      reportStage('ocr-recognition-output-dispose-start', { ...context });
      disposeTensors(outputs);
      reportStage('ocr-recognition-output-dispose-done', { ...context });
      reportStage('ocr-recognition-input-dispose-start', { ...context, inputEstimatedBytes: inputBytes });
      disposeTensors({ input });
      diagnosticReporter.releaseStart('ocr-recognition-input-buffer-release-start', inputId, { ...context });
      diagnosticReporter.releaseDone('ocr-recognition-input-buffer-release-done', inputId, { ...context });
      reportStage('ocr-recognition-input-dispose-done', { ...context });
      values = null;
    }
  }

  async function recognizeBrowserLineVariants(line, lineIndex, lineCount) {
    const isRingLine = String(line.groupId || '').startsWith('ring:');
    return core.runRecognizeVariants({
      source: line.image,
      preprocess: (source, mode, context) => core.preprocessRgba(source, mode, context.diagnostics, context.allocationId),
      rotate: (source, angle, context) => core.rotateRgba(source, angle, context.diagnostics, context.allocationId),
      recognize: (image, context) => recognizeCanvas(image, isRingLine, activeAbortController?.signal, context),
      reportStage,
      diagnostics: diagnosticReporter,
      lineIndex,
      lineCount,
      signal: activeAbortController?.signal,
    });
  }

  let cv = null;
  let clipper = null;
  let perspectiveTransform = null;
  async function ensureOcrImageRuntimes() {
    reportStage('ocr-opencv-import-start', { opencvLoaded: false });
    const cvModule = await loadOcrResource('OpenCV module', () => import(dependencies.opencvUrl));
    reportStage('ocr-opencv-import-done');
    const importedCv = cvModule.default ?? cvModule;
    reportStage('ocr-opencv-runtime-init-start');
    cv = importedCv instanceof Promise ? await importedCv : importedCv;
    if (!cv.Mat) await new Promise(resolve => {
      const previous = cv.onRuntimeInitialized;
      cv.onRuntimeInitialized = () => { previous?.(); resolve(); };
    });
    reportStage('ocr-opencv-runtime-init-done', { runtimeState: { opencvLoaded: true } });
    if (!ocrCvResourceTracker) {
      ocrCvResourceTracker = global.MagiaOcrResourceTracker.create((error, details) => reportCleanupError('opencv-resource-delete', error, details));
      perspectiveTransform = cv.getPerspectiveTransform;
      if (typeof perspectiveTransform === 'function') {
        const nativePerspectiveTransform = perspectiveTransform;
        let warnedAboutPerspectiveBinding = false;
        perspectiveTransform = function (source, destination, ...options) {
          try { return nativePerspectiveTransform.call(cv, source, destination, ...options); }
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
      releaseOcrCvResources = () => ocrCvResourceTracker?.releaseAll({ phase: 'worker-finally' }) ?? true;
    }
    reportStage('ocr-clipper-import-start', { opencvLoaded: true, clipperLoaded: false });
    const clipperModule = await loadOcrResource('Clipper module', () => import(dependencies.clipperUrl));
    reportStage('ocr-clipper-import-done', { runtimeState: { clipperLoaded: true } });
    clipper = clipperModule.default ?? clipperModule;
  }

  async function ensureTextDetector() {
    if (textDetectorPromise) return textDetectorPromise;
    textDetectorPromise = (async () => {
      reportStage('ocr-detection-ort-import-start');
      const ort = await loadOcrResource('detection ONNX Runtime module', () => import(ocrRuntimeUrl));
      reportStage('ocr-detection-ort-import-done', { version: ort.env.versions?.web || core.config.onnxRuntimeWebVersion });
      ort.env.wasm.wasmPaths = dependencies.onnxRuntimeWasmPath;
      ort.env.wasm.numThreads = runtimeDefaults.numThreads;
      ort.env.wasm.proxy = false;
      let detectionSession = null;
      let detectionModel = null;
      let detectionModelTracked = false;
      try {
        reportStage('ocr-detection-model-fetch-start', { url: core.config.detectionModelUrl });
        const detectionResponse = await loadOcrResource('detection model', () => ocrCache.load(core.config.detectionModelUrl));
        reportStage('ocr-detection-model-fetch-done', { contentLength: Number(detectionResponse.headers?.get('content-length')) || null });
        const estimatedModelBytes = Number(detectionResponse.headers?.get('content-length')) || 0;
        reportStage('ocr-detection-model-arraybuffer-start', { estimatedBytes: estimatedModelBytes, allocationId: 'detection-model-buffer' });
        diagnosticReporter.allocationStart('ocr-detection-model-buffer-alloc-start', 'detection-model-buffer', estimatedModelBytes, {
          name: 'Detection model ArrayBuffer', type: 'ArrayBuffer',
        });
        detectionModel = await loadOcrResource('detection model response body', () => detectionResponse.arrayBuffer());
        reportStage('ocr-detection-model-arraybuffer-done', { modelBytes: detectionModel.byteLength });
        diagnosticReporter.allocationDone('ocr-detection-model-arraybuffer-ready', 'detection-model-buffer', detectionModel.byteLength, {
          name: 'Detection model ArrayBuffer', type: 'ArrayBuffer',
        });
        detectionModelTracked = true;
        reportStage('ocr-detection-session-create-start', { modelBytes: detectionModel.byteLength, sessionOptions: ocrSessionOptions });
        reportStage('ocr-detection-wasm-runtime-init-start', { numThreads: runtimeDefaults.numThreads, runtimeUrl: ocrRuntimeUrl });
        detectionSession = await ort.InferenceSession.create(
          detectionModel,
          { ...ocrSessionOptions },
        );
        reportStage('ocr-detection-session-create-done', { modelBytes: detectionModel.byteLength, runtimeState: { ortDetectionLoaded: true } });
        reportStage('ocr-detection-wasm-runtime-init-done', { version: ort.env.versions?.web || core.config.onnxRuntimeWebVersion });
        diagnosticReporter.releaseStart('ocr-detection-model-buffer-release-start', 'detection-model-buffer', { type: 'ArrayBuffer' });
        detectionModel = null;
        diagnosticReporter.releaseDone('ocr-detection-model-buffer-release-done', 'detection-model-buffer');
        detectionModelTracked = false;
      } catch (error) {
        if (detectionSession) {
          try { await detectionSession.release(); }
          catch (releaseError) { reportCleanupError('detection-session-release', releaseError, { reason: 'session-create-failed' }); }
          finally { detectionSession = null; }
        }
        if (detectionModelTracked) diagnosticReporter.releaseDone('ocr-detection-model-buffer-release-done', 'detection-model-buffer', { reason: 'session-create-failed' });
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
        reportStage('ocr-detection-session-release-start');
        try {
          await session.release();
          reportStage('ocr-detection-session-release-done', { runtimeState: { ortDetectionLoaded: false } });
        } catch (error) {
          reportCleanupError('detection-session-release', error);
        }
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
          let sessionForRun = detectionSession;
          let memory = null;
          let completed = false;
          let inputAllocationTracked = false;
          let maskAllocationTracked = false;
          try {
            throwIfAborted(signal);
            image = await BrowserImageRaw.open(source);
            const width = Math.max(32, Math.ceil(image.width / 32) * 32);
            const height = Math.max(32, Math.ceil(image.height / 32) * 32);
            diagnosticReporter.updateContext({ sourceWidth: image.width, sourceHeight: image.height, detectionTensorWidth: width, detectionTensorHeight: height });
            memory = {
              ocrInputWidth: image.width,
              ocrInputHeight: image.height,
              sourceWidth: image.width,
              sourceHeight: image.height,
              detectionTensorWidth: width,
              detectionTensorHeight: height,
              inputFloat32EstimatedBytes: width * height * 3 * Float32Array.BYTES_PER_ELEMENT,
            };

            reportStage('ocr-detection-input-start', memory);
            inputValues = imageAnalysis.resizeRgbaSharpContainToPlanarFloat32(image.data, image.width, image.height, width, height, diagnosticReporter);
            inputAllocationTracked = true;
            reportStage('ocr-detection-tensor-create-start', { ...memory, tensorShape: [1, 3, height, width] });
            inputTensor = new ort.Tensor('float32', inputValues, [1, 3, height, width]);
            reportStage('ocr-detection-tensor-create-done', { ...memory, tensorShape: [1, 3, height, width] });
            inputValues = null;
            reportStage('ocr-detection-input-ready', memory);
            throwIfAborted(signal);
            reportStage('ocr-detection-run-start', {
              ...memory, tensorShape: [1, 3, height, width], inputEstimatedBytes: memory.inputFloat32EstimatedBytes,
              knownLiveBytes: diagnosticReporter.knownLiveBytes,
              opencvLoaded: Boolean(cv),
              clipperLoaded: Boolean(clipper),
            });
            if (cv) throw new Error('OpenCV must remain unloaded during Detection inference.');
            outputs = await sessionForRun.run({ [sessionForRun.inputNames[0]]: inputTensor });
            reportStage('ocr-detection-run-done', { ...memory, tensorShape: [1, 3, height, width] });
            throwIfAborted(signal);

            reportStage('ocr-detection-output-read-start', { ...memory, outputCount: Object.keys(outputs || {}).length });
            modelOutput = outputs[sessionForRun.outputNames[0]];
            const outputHeight = modelOutput.dims[2];
            const outputWidth = modelOutput.dims[3];
            reportStage('ocr-detection-output-read-done', { ...memory, outputShape: [...modelOutput.dims], outputElementCount: modelOutput.data?.length || 0 });
            memory.detectionMaskWidth = outputWidth;
            memory.detectionMaskHeight = outputHeight;
            memory.maskEstimatedBytes = outputWidth * outputHeight * Uint8Array.BYTES_PER_ELEMENT;
            reportStage('ocr-detection-mask-start', memory);
            diagnosticReporter.allocationStart('ocr-detection-mask-buffer-alloc-start', 'detection-mask-uint8', memory.maskEstimatedBytes, {
              name: 'Detection Uint8 mask', width: outputWidth, height: outputHeight, type: 'Uint8Array',
            });
            mask = new Uint8Array(outputWidth * outputHeight);
            maskAllocationTracked = true;
            diagnosticReporter.allocationDone('ocr-detection-mask-buffer-alloc-done', 'detection-mask-uint8', mask.byteLength, {
              name: 'Detection Uint8 mask', width: outputWidth, height: outputHeight, type: 'Uint8Array',
            });
            reportStage('ocr-detection-mask-fill-start', { ...memory, estimatedBytes: mask.byteLength });
            for (let index = 0; index < modelOutput.data.length; index += 1) {
              mask[index] = modelOutput.data[index] > 0.03 ? 255 : 0;
            }
            reportStage('ocr-detection-mask-fill-done', { ...memory, estimatedBytes: mask.byteLength });
            reportStage('ocr-detection-mask-ready', memory);

            reportStage('ocr-detection-output-dispose-start', { ...memory, outputCount: Object.keys(outputs || {}).length });
            disposeTensors(outputs);
            outputs = null;
            modelOutput = null;
            reportStage('ocr-detection-output-dispose-done', memory);
            reportStage('ocr-detection-input-dispose-start', { ...memory, inputEstimatedBytes: memory.inputFloat32EstimatedBytes });
            disposeTensors({ input: inputTensor });
            inputTensor = null;
            inputValues = null;
            diagnosticReporter.releaseStart('ocr-detection-input-buffer-release-start', 'detection-input-float32', { width, height, type: 'Float32Array' });
            diagnosticReporter.releaseDone('ocr-detection-input-dispose-done', 'detection-input-float32');
            inputAllocationTracked = false;
            await releaseDetectionSession();
            sessionForRun = null;
            reportStage('ocr-detection-session-release', memory);

            reportStage('ocr-detection-cleanup-done', {
              ...memory,
              opencvLoaded: Boolean(cv),
              remainingTrackedBytes: diagnosticReporter.knownLiveBytes,
            });
            // Only source + the compact mask leave this runtime. Main terminates it
            // before OpenCV or source alignment can allocate any memory.
            const detected = {
              buffer: image.data.buffer, width: image.width, height: image.height,
              mask, maskWidth: outputWidth, maskHeight: outputHeight,
              detectionWidth: width, detectionHeight: height,
            };
            diagnosticReporter.releaseDone('ocr-detection-mask-release-done', 'detection-mask-uint8', { ownershipTransferred: true });
            maskAllocationTracked = false;
            mask = null;
            completed = true;
            return detected;
          } finally {
            try {
              if (outputs) reportStage('ocr-detection-output-dispose-start', { ...memory, cleanup: true });
              disposeTensors(outputs);
              outputs = null;
              modelOutput = null;
              if (inputTensor) reportStage('ocr-detection-input-dispose-start', { ...memory, cleanup: true });
              disposeTensors({ input: inputTensor });
              inputTensor = null;
              inputValues = null;
              if (inputAllocationTracked) {
                diagnosticReporter.releaseStart('ocr-detection-input-dispose-start', 'detection-input-float32', { cleanup: true });
                diagnosticReporter.releaseDone('ocr-detection-input-dispose-done', 'detection-input-float32', { cleanup: true });
                inputAllocationTracked = false;
              }
              if (maskAllocationTracked) {
                diagnosticReporter.releaseStart('ocr-detection-mask-release-start', 'detection-mask-uint8', { cleanup: true });
                diagnosticReporter.releaseDone('ocr-detection-mask-release-done', 'detection-mask-uint8', { cleanup: true });
                maskAllocationTracked = false;
              }
              mask = null;
              if (detectionSession) {
                await releaseDetectionSession();
                sessionForRun = null;
                reportStage('ocr-detection-session-release', memory);
              }
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

  async function prepareLines(message, signal) {
    let source = { data: new Uint8ClampedArray(message.buffer), width: message.width, height: message.height };
    let alignment = null;
    let resources = null;
    try {
      alignment = global.MagiaOcrLineSplitter.alignSource(source, message.detectionWidth, message.detectionHeight, diagnosticReporter);
      await ensureOcrImageRuntimes();
      throwIfAborted(signal);
      resources = global.MagiaOcrLineSplitter.create(
        cv, clipper, message.mask, message.maskWidth, message.maskHeight,
        source, message.detectionWidth, message.detectionHeight,
        () => { message.mask = null; }, diagnosticReporter,
        resource => ocrCvResourceTracker.track(resource),
        (resource, details) => ocrCvResourceTracker.delete(resource, details),
        perspectiveTransform, alignment, reportCleanupError,
      );
      alignment = null;
      const lineImages = resources.materialize();
      resources.release();
      resources = null;
      // Ring fallback uses exactly the original source and sampling, before it is
      // discarded. Only the small line images survive into Recognition.
      const additionalLineImages = lineImages.length <= 8
        ? [...core.iterateRingSectors(source, { diagnostics: diagnosticReporter, lineOffset: lineImages.length })]
          .map(line => ({ ...line, image: { data: line.image.data, width: line.image.width, height: line.image.height } }))
        : [];
      return { lineImages, additionalLineImages, resizedImageWidth: message.detectionWidth, resizedImageHeight: message.detectionHeight };
    } finally {
      resources?.release();
      alignment?.release();
      releaseOcrCvResources?.();
      releaseOcrCvResources = null;
      source = null;
      message.buffer = null;
      message.mask = null;
    }
  }

  async function runPhase(message, signal) {
    reportStage('ocr-phase-start', { workerPhase: message.phase });
    let detector = null;
    try {
      if (message.phase === 'detection') {
        detector = await ensureTextDetector();
        throwIfAborted(signal);
        return await detector.detect({ data: new Uint8ClampedArray(message.buffer), width: message.width, height: message.height }, signal);
      }
      if (message.phase === 'geometry') return await prepareLines(message, signal);
      if (message.phase !== 'recognition') throw new TypeError('Unknown OCR worker phase.');
      reportStage('ocr-recognition-start');
      const result = await core.run({
        detect: async () => ({
          lineImages: message.lineImages, additionalLineImages: message.additionalLineImages,
          resizedImageWidth: message.resizedImageWidth, resizedImageHeight: message.resizedImageHeight,
        }),
        recognizeVariants: recognizeBrowserLineVariants,
        combineLines: combineSpellLineImages,
        vocabularyCorrector: null,
        releaseLinePixelsAfterRecognition: true,
        reportStage,
        signal,
      });
      reportStage('ocr-recognition-done');
      return result;
    } finally {
      await releaseOcrModels(detector);
      cleanupErrorAggregator.flush();
      reportStage('ocr-phase-done', { workerPhase: message.phase });
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
    diagnosticReporter.begin(message.runId, {
      sourceWidth: message.width,
      sourceHeight: message.height,
      onnxRuntimeVersion: core.config.onnxRuntimeWebVersion,
      graphOptimizationLevel: runtimeDefaults.graphOptimizationLevel,
      numThreads: runtimeDefaults.numThreads,
    });
    activeAbortController = new AbortController();
    void (async () => {
      try {
        reportStage('ocr-worker-processing-start', {
          sourceWidth: message.width, sourceHeight: message.height,
          estimatedBytes: Number(message.width) * Number(message.height) * 4,
          workerPhase: message.phase, type: 'transferred ArrayBuffer',
        });
        const result = await runPhase(message, activeAbortController.signal);
        const transfers = message.phase === 'detection'
          ? [result.buffer, result.mask.buffer]
          : message.phase === 'geometry'
            ? [...result.lineImages, ...result.additionalLineImages].map(line => line.image.data.buffer)
            : [];
        global.postMessage({ type: 'success', jobId: activeJobId, result }, [...new Set(transfers)]);
      } catch (error) {
        global.postMessage({
          type: 'error',
          jobId: activeJobId,
          name: error?.name || 'Error',
          message: error?.message || String(error),
          ...(error?.code ? { code: error.code } : {}),
          retryable: global.MagiaOcrErrorPolicy.isRetryableOcrError(error),
          ...(error?.resource ? { resource: error.resource } : {}),
        });
      } finally {
        message.buffer = null;
        activeAbortController = null;
        activeJobId = null;
      }
    })();
  });
})(globalThis);
