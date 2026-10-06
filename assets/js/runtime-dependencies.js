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
    // Mirrored from external-assets.json; the offline dependency test enforces exact agreement.
    ocrAssetIntegrity: Object.freeze({
      [`${models}ch_PP-OCRv4_det_infer.onnx`]: Object.freeze({
        bytes: 4745517,
        sha256: '30a86f5731181461d08021402766601e4302a9b9b9666be8aff402696339cdff',
      }),
      [`${models}ch_PP-OCRv4_rec_infer.onnx`]: Object.freeze({
        bytes: 10822323,
        sha256: '06b3e6af6c59a1ba5d53790ed8c2e4b2de389870b6cf5a97f349f3412cb269c0',
      }),
      [`${models}ppocr_keys_v1.txt`]: Object.freeze({
        bytes: 26249,
        sha256: '28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7',
      }),
    }),
    forbiddenWordsUrl: 'https://raw.githubusercontent.com/dsojevic/profanity-list/c27924319aa9bd6f917e3782b4f4b6604a50b652/en.txt',
    commonWordsUrl: 'https://raw.githubusercontent.com/nlile/dictionary-word-list/842089dfe25f96fc872f3dc260419b02abc9c5a2/word_list_very_common_en_us_spelling_no_diacritic.txt',
  });
}(globalThis));
