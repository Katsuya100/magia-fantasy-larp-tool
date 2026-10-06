# Browser and batch image comparison

1. Start the local page with `npm run serve` and open `http://127.0.0.1:8765/magia-circle.html?diagnostics`.
2. Select an image in the browser UI, then press **陣を読み解く**. After analysis completes, use **診断JSONを保存** to save the browser measurements, OCR lines/candidates, attribute rates, sigil scores, and power breakdown.
3. Save the batch result with `npm run test:image-outputs -- <image-path> > batch.json`. The default batch OCR uses the Node native runtime that defines the reference behavior.
4. Compare both files with `npm run compare:image-outputs -- <browser.json> <batch.json>`.

The comparator checks the rendered result by default: spell text, all displayed attribute and sigil percentages, power, word count, and rounded detail bars. It exits with status 1 if a displayed value differs. The result also reports whether low-level diagnostics match; OCR line boxes and vote counts, or tiny embedding floats, can differ even when the page displays the same result. Add `--strict` before the JSON paths to compare every diagnostic field with a `1e-9` numeric tolerance and fail on any difference. Add `--web-wasm` before the image path only when comparing the browser-compatible OCR runtime; the default batch remains the reference runtime.

Fixed historical outputs live in `fixtures/image-outputs/`; historical timing reports live in `benchmarks/onnxruntime/`. Store new results in `test-results/` (ignored by Git). The benchmark script's default baseline is `fixtures/image-outputs/updated-web-wasm-sample.json` and its new report still goes to `test-results/onnxruntime/graph-optimization-ab.json`.

`npm run test:e2e` executes the sample image plus actual Worker lifecycle/pipeline and detector checks. It needs model downloads on its first run, and is separate from the 21 offline suites in `npm test`. The GitHub Actions image workflow supports manual and weekly execution, with a disk cache for the pinned model revision. Runtime versions, model revision, q8 and WASM options are shared in `assets/js/runtime-dependencies.js`.
