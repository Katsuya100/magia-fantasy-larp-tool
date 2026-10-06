# レビュー・修正報告（2026-10-06）

基準は `89e80a1` の既存実装・テストです。ゲームの計算式、世界観、スタイルとWorkerによる端末内解析を維持し、まずコトダマギアの巨大ZIP取得を除去しました。元から未追跡だった `.tmp/` と `test-results/onnxruntime/worker-lifecycle-summary.json` は削除・commitしていません。

## 各変更の問題・対応・維持・検証

| 変更 | 問題 | 対応 | 維持した仕様 | 検証 |
| --- | --- | --- | --- | --- |
| 軽量GloVe | 初回862MB ZIP・巨大IndexedDB分冊 | Nodeで40,146語をprune、Float32とJSONを配布、ブラウザのZIP/fflate実装を削除 | 元50次元Float32の値・属性語・全固定頻度候補 | 全2,007,300要素一致、全2,516候補保持、再取得/再生成byte一致、generator tests |
| コトダマギア分割 | HTML/CSS/取得/計算/描画の集中 | CSS、app、attributes、VectorStore、data、scoring、renderingへ分割 | 元CSS・lore・顕現境界75%/禁忌90%・真名減衰・重複語・写本/偶然の墨 | 14術式golden、実appイベントharness、390pxブラウザ |
| cache・失敗 | 古い巨大cache・破損控え・保存制限 | SHA検証、旧資材削除、破損控えの限定再取得、保存/削除拒否でも続行、完成manifestのoffline fallback | 手動で外典を開き直す導線、memory/WASM errorをretryしない | cache/storage/quota/offline/refresh/error tests |
| マギアサークル分割 | 巨大appの診断・描画責務 | diagnostics、diagnostic-view、resultsに分割、Worker制御はappに維持 | abort/terminate/resource cleanup、Structure→OCR→画像解放→Embedding、共有計算 | Worker client 18失敗/abortケース、handshake、resource tracker、実Worker/ブラウザ・batch比較 |
| CI・再現性 | 統合test/CIなし、dist設定だけ存在 | npm test/check/build、固定SHAのActions、手動画像E2E、静的dist生成 | rootのPages公開、静的ホスティング、軽量生成物から起動 | 18 offline suites、syntax/build、実E2E、npm ci |
| 外部依存 | main/master参照、モデル設定の分散 | commit/versionとモデルrevisionを固定、runtime共有定義、hash台帳・明示的な照合script | Worker/Nodeのq8/WASM・同じmodel/source | 全6モデル/辞書hash照合、runtime dependency tests |
| sharp安全性 | npm auditで3 high | sharp0.35.4へ統一、lockとoverride | ブラウザ計算は未変更、Nodeの画像処理APIを維持 | audit0、更新前後/既存基準の画像出力全項目一致 |
| HTML安全性・通知 | 外部語/例外の未escape、runtime通知の欠落 | 例外/入力にDOM、近傍語escape、onnxruntime/js-clipperを含む通知と原文ライセンスを同梱 | 元テンプレート・warning装飾・用語 | 悪意ある文字列の表示tests、license全文hash照合 |
| 資材配置 | rootとtest-resultsに固定JSON/計測混在 | 固定基準はfixtures、歴史的計測はbenchmarks、生成reportはtest-resultsでignore | 固定JSONの内容はそのまま、参照と既定出力を更新 | 参照検索、差分、基準比較 |

## 実行した検証と結果

- `npm ci` 成功。最初の実行は環境のCAで失敗したため、`NODE_OPTIONS=--use-system-ca` とworkspace npm cacheで解決。TLS検証を無効化していません。
- `npm run check` と `npm run build` 成功。`.openai/hosting.json` が指定するdistへ静的資材とライセンスを生成。
- `npm test`: 18ネットワーク不要スイート成功。威力・相・pipeline、model cache、画像tensor/紋、診断、structure handshake、OCR materialization/client/resources、結果描画、外部依存、軽量辞書/loader/語彙/scoring/appを含みます。
- `npm run test:image-outputs -- assets/images/sample.png`: 画像から最後まで成功。既存native基準と変更後出力は全項目差分0。sharp変更前後も差分0。
- 実OCR Worker lifecycle: 2回とも終了、activeWorkers=0 / maximumActive=1。
- 完全Worker pipeline: 2回とも既存基準の呪文・相・紋・威力と一致、終了後Workerと追跡buffer=0。診断storage書込79回（既存上限100未満）。
- 検出stress: recreate/reuseを各2回、geometry sample成功。
- 実ブラウザ（Chromium154/Windows）: 画像の相flame、紋attack、威力1190。browser/batch comparatorは表示差分0・診断差分0。終了後追跡buffer0、全Worker0、OpenCV source Mat作成1回。tracked buffer peak28,157,092 bytes（runtime内部・語彙索引等を含む総メモリpeakではない）。
- ブラウザ390px幅: コトダマギア/マギアサークルの結果を確認。document widthとscrollWidthは375pxで一致。
- `verify:external-assets -- --models`: OCRモデル2件・OCR辞書・禁止語・SCOWL・Embeddingモデルの6件全てhash一致。
- GloVe/lexicon生成: source再取得と別dir生成byte一致、必須85語と頻度4,324語、全候補2,516語保持。
- `benchmark:kotodama`: ローカルNode loader 133.86ms。測定対象・限界は [KOTODAMA-DATA.md](KOTODAMA-DATA.md) に明記。

`npm run test:e2e` の統合実行も全6確認で成功しました。

通常CIはモデルを使うE2Eを実行しません。Linuxで不要なCUDAバイナリをdownloadしないよう、両workflowに `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` を設定しています。GitHub Actions上の結果はpush後に確認します。

## ダウンロード量

旧ZIP862,182,753 bytes → 新辞書一式8,551,008 bytes。853,631,745 bytes削減、約99.01%減。cache payload概算も旧ZIP+TXTだけで約1.03GBから新規分約8.55MBへ減ります。旧databaseを別タブで開いている場合など、削除保留時の残量はこの概算に含みません。

## 残る課題・追加確認

- 収録外の旧入力語は使えません。計算式は同じですが、語彙のpruneは意図的な入力範囲の変更です。
- GeoNamesを固定JSON版にすることで、旧ライブZIP/過去cacheとの収録時点差があり得ます。固定入力の全近傍候補がpruneで欠落しないことを確認しました。
- Android/iOS実機、Safari/Firefox、カメラ、低メモリ端末の総peak/実ネットワークを含む起動時間は未検証です。desktop Nodeの計測をモバイルの実測値として扱いません。
- マギアサークルの大きなSCOWL補正索引、CDN/モデル取得量の更なる削減は別課題です。精度や辞書を独断で変えていません。
- ライセンス: ONNX変換weightと版の対応、SCOWL生成版/原文通知の対応、頻度/人名の上流条件、GeoNamesミラーの変換履歴は要確認。学習済みGloVeはPDDL、コードはApacheという区別、CC BY帰属、Boost/JSBN表示などは [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) に反映しました。
- E2E中、NodeのHTTPS ESM非対応がEmbedding harnessで判明。browser固定WASM URLを検査した上で、Nodeだけ同じ版のローカルWASMへI/Oを変換して解決しました。production backendや計算を変更してエラーを隠していません。

## ファイル一覧

以下は今回の変更対象です。歴史的JSONの削除表示は移動を意味します。Windows専用の未参照画像decode補助 `tests/decode-jpeg.ps1` は既存sharpで置き換えて削除しました。テストのアサーションは維持しています。生成レポート・原モデルはGit対象外です。

### 変更した既存ファイル

```text
.gitignore
README.md
THIRD_PARTY_NOTICES.md
assets/js/attribute-embedding-worker.js
assets/js/image-analysis-worker.js
assets/js/magia-circle-app.js
assets/js/magia-circle-ocr-worker.js
assets/js/magia-image-pipeline.js
assets/js/spell-ocr.js
docs/IMAGE-OUTPUT-COMPARISON.md
kotodama.html
magia-circle.html
package-lock.json
package.json
scripts/serve-dist.mjs
tests/benchmark-image-outputs.mjs
tests/test-analysis-diagnostics.mjs
tests/test-analysis-worker-pipeline.mjs
tests/test-detection-stress.mjs
tests/test-image-analysis.mjs
tests/test-image-outputs.mjs
tests/test-image-pipeline.mjs
tests/test-ocr-worker-client.mjs
tests/test-ocr-worker-lifecycle.mjs
tests/test-spell-ocr.mjs
```

### 新規ファイル

```text
.gitattributes
.github/workflows/ci.yml
.github/workflows/image-e2e.yml
assets/css/kotodama.css
assets/data/external-assets.json
assets/data/kotodama-lexicon.json
assets/data/kotodama-lexicon.meta.json
assets/data/kotodama-vectors.f32
assets/data/kotodama-vectors.meta.json
assets/data/kotodama-vectors.words.json
assets/js/kotodama-app.js
assets/js/kotodama-attributes.js
assets/js/kotodama-data.js
assets/js/kotodama-rendering.js
assets/js/kotodama-scoring.js
assets/js/kotodama-vector-store.js
assets/js/magia-circle-diagnostic-view.js
assets/js/magia-circle-diagnostics.js
assets/js/magia-circle-results.js
assets/js/runtime-dependencies.js
assets/licenses/clipper-Boost-1.0.txt
assets/licenses/clipper-JSBN-LICENSE.txt
assets/licenses/english-words-MIT.txt
assets/licenses/geonames-CC-BY-4.0.txt
assets/licenses/glove-PDDL-1.0.txt
assets/licenses/guten-ocr-MIT.txt
assets/licenses/humannames-MIT.txt
assets/licenses/jinja-MIT.txt
assets/licenses/natural-earth-Public-Domain.txt
assets/licenses/onnxruntime-MIT.txt
assets/licenses/onnxruntime-embedding-ThirdPartyNotices.txt
assets/licenses/onnxruntime-node-ThirdPartyNotices.txt
assets/licenses/onnxruntime-ocr-ThirdPartyNotices.txt
assets/licenses/opencv-Apache-2.0.txt
assets/licenses/paddleocr-Apache-2.0.txt
assets/licenses/profanity-list-MIT.txt
assets/licenses/scowl-upstream-Copyright.txt
assets/licenses/scowl-word-list-Copyright.txt
assets/licenses/sharp-Apache-2.0.txt
assets/licenses/sources.json
assets/licenses/tiny-invariant-MIT.txt
assets/licenses/transformers-Apache-2.0.txt
benchmarks/onnxruntime/baseline-vs-ort130.json
benchmarks/onnxruntime/baseline117-vs-ort130.json
benchmarks/onnxruntime/detection-stress-all.json
benchmarks/onnxruntime/detection-stress-basic.json
benchmarks/onnxruntime/detection-stress-disabled.json
benchmarks/onnxruntime/detection-stress-extended.json
benchmarks/onnxruntime/graph-optimization-ab.json
docs/KOTODAMA-DATA.md
docs/REVIEW-CHANGES.md
fixtures/image-outputs/baseline-ort117-sample.json
fixtures/image-outputs/baseline-web-wasm-sample.json
fixtures/image-outputs/native-image-output-sample.json
fixtures/image-outputs/updated-web-wasm-sample.json
fixtures/kotodama/scoring-baseline.json
scripts/benchmark-kotodama-data.mjs
scripts/build-kotodama-lexicon.mjs
scripts/build-kotodama-vectors.mjs
scripts/build-static.mjs
scripts/check-syntax.mjs
scripts/kotodama-lexicon.mjs
scripts/run-image-e2e.mjs
scripts/run-tests.mjs
scripts/verify-external-assets.mjs
tests/kotodama-harness.mjs
tests/test-kotodama-app.mjs
tests/test-kotodama-data.mjs
tests/test-kotodama-lexicon.mjs
tests/test-kotodama-scoring.mjs
tests/test-kotodama-vectors.mjs
tests/test-magia-circle-results.mjs
tests/test-runtime-dependencies.mjs
```

### 削除した旧パス

```text
baseline-ort117-sample.json
baseline-vs-ort130.json
baseline-web-wasm-sample.json
baseline117-vs-ort130.json
test-results/onnxruntime/detection-stress-all.json
test-results/onnxruntime/detection-stress-basic.json
test-results/onnxruntime/detection-stress-disabled.json
test-results/onnxruntime/detection-stress-extended.json
test-results/onnxruntime/graph-optimization-ab.json
test-results/onnxruntime/native-image-output-sample.json
tests/decode-jpeg.ps1
updated-web-wasm-sample.json
```
