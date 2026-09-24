# Browser and batch image comparison

1. Start the local page with `npm run serve` and open `http://127.0.0.1:8765/magia-circle.html?diagnostics`.
2. Select an image in the browser UI. After analysis completes, use **診断JSONを保存** to save the browser measurements, OCR lines/candidates, attribute rates, sigil scores, and power breakdown.
3. Save the batch result with `npm run test:image-outputs -- <image-path> > batch.json`. The default batch OCR uses the Node native runtime that defines the reference behavior.
4. Compare both files with `npm run compare:image-outputs -- <browser.json> <batch.json>`.

The comparator checks the rendered result by default: spell text, all displayed attribute and sigil percentages, power, word count, and rounded detail bars. It exits with status 1 if a displayed value differs. The result also reports whether low-level diagnostics match; OCR line boxes and vote counts, or tiny embedding floats, can differ even when the page displays the same result. Add `--strict` before the JSON paths to compare every diagnostic field with a `1e-9` numeric tolerance and fail on any difference. Add `--web-wasm` before the image path only when comparing the browser-compatible OCR runtime; the default batch remains the reference runtime.
