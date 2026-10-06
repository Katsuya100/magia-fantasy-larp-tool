/* Immutable runtime inputs shared by classic Workers, module Workers and Node batches. */
(function exposeRuntimeDependencies(global) {
  'use strict';

  const cdn = 'https://cdn.jsdelivr.net/npm/';
  const models = `${cdn}@gutenye/ocr-models@1.2.2/`;
  global.MagiaRuntimeDependencies = Object.freeze({
    transformersVersion: '3.8.1',
    transformersUrl: `${cdn}@huggingface/transformers@3.8.1`,
    transformersWasmPath: `${cdn}@huggingface/transformers@3.8.1/dist/`,
    // Transformers.js 3.8.1 bundles this runtime. OCR deliberately uses its own version.
    embeddingOnnxRuntimeVersion: '1.22.0-dev.20250409-89f8206ba4',
    attributeModelId: 'Xenova/all-MiniLM-L6-v2',
    attributeModelRevision: '751bff37182d3f1213fa05d7196b954e230abad9',
    attributeModelOptions: Object.freeze({
      revision: '751bff37182d3f1213fa05d7196b954e230abad9',
      device: 'wasm',
      dtype: 'q8',
    }),
    onnxRuntimeWebVersion: '1.30.0',
    onnxRuntimeUrl: `${cdn}onnxruntime-web@1.30.0/dist/ort.wasm.min.mjs`,
    onnxRuntimeWasmPath: `${cdn}onnxruntime-web@1.30.0/dist/`,
    opencvVersion: '4.9.0-release.3',
    opencvUrl: `${cdn}@techstark/opencv-js@4.9.0-release.3/+esm`,
    clipperVersion: '1.0.1',
    clipperUrl: `${cdn}js-clipper@1.0.1/+esm`,
    detectionModelUrl: `${models}ch_PP-OCRv4_det_infer.onnx`,
    recognitionModelUrl: `${models}ch_PP-OCRv4_rec_infer.onnx`,
    dictionaryUrl: `${models}ppocr_keys_v1.txt`,
    forbiddenWordsUrl: 'https://raw.githubusercontent.com/dsojevic/profanity-list/c27924319aa9bd6f917e3782b4f4b6604a50b652/en.txt',
    commonWordsUrl: 'https://raw.githubusercontent.com/nlile/dictionary-word-list/842089dfe25f96fc872f3dc260419b02abc9c5a2/word_list_very_common_en_us_spelling_no_diacritic.txt',
  });
}(globalThis));
