# 自由入力復元・追加修正報告（2026-10-06）

対象は前回のmain `c0a4b48`、仕様の基準は旧 `89e80a197281c7a08f79ae1a03dcf5dd209c52e6` です。旧HTMLのgit blobを確認し、入力の存在確認・禁止語判定と、候補出力の厳しいgateが別であることを再確認しました。

## 仕様差分と処理

| 項目 | 今回の結果 |
| --- | --- |
| 入力用GloVe | 旧上限と同じ400,000語を搭載。末尾追加`<unk>`は旧上限と同様に含めない |
| 入力の構文 | 元の英数字・underscore・+/-を維持。一語で直接表せる327,245語、搭載禁止語195語を除いた327,050語を使用可能 |
| 候補語数 | 元の2,516語を維持。近傍、反転、欠片、偶然の墨、写本がこのlexiconだけを使う |
| 禁止語 | リスト463語。GloVeにある195語をparse時に明示拒否し、候補にも出さない |
| 人名・地名 | それだけで入力拒否しない。`usain / john / london`の入力と候補除外を確認 |
| rare語 | 前回prune外の`anemometer / quasar / astrolabe / chiaroscuro / syzygy`等を入力・計算可能に復元 |
| allowlist | NAME/PLACEの全件と順序を旧fixtureで確認。政治・国家・身分・ファンタジー例外を整理・縮小しない |
| API境界 | `inputVectors`と`candidateVectors`、`candidateWords`/`candidateLexicon`を明示。`isInputWord`/`isForbiddenWord`/`isCandidateWord`は別関数 |
| 数値・ゲーム | 50次元Float32、cosine、顕現75%・hidden90%・真名減衰・威力式・候補rank演算は変更しない |

**例示語に関する旧コードの事実:** turkey/orange/reading/mobile/niceはPLACE allowlistにありますが、固定辞書では別のNAME gateを通らず、元の2,516候補にはありません。全ゲート・ランキング維持という禁止事項に従い、候補へ強制追加しません。入力は可能です。例外の免除そのものは、他のgateも通る合成fixtureで候補可になることを確認しています。river/storm/king/queen/empire/state等は実辞書でも入力可・候補可です。

## GloVe配布・起動・メモリ

案A（全数値80MB）、B（分割）、C（Range）を比較し、**B**を採用しました。既存40,146語の軽量資材をbyte保持し、残り359,854語を64区画の標準Float32LEへ配布します。全入力の索引は小さな整数location Mapです。ブラウザのRange、巨大ZIP、新しい大型frameworkは使用しません。

| 比較（payload bytes） | 前回40,146語版 | 自由入力復元後 |
| --- | ---: | ---: |
| 初回 | 8,551,008 | 12,307,658 |
| 初回Cache本体 | 8,550,354 | 12,305,087 |
| 常駐数値配列 | 8,029,200 | 8,029,200 |
| 全補助取得時の全payload | — | 84,278,458 |
| 全補助取得時のCache本体概算 | — | 84,275,887 |

各区画1,103,000～1,150,000 bytesを必要時だけ順次読みます。使用語の200-byte rowをコピーし、区画全体を保持しません。現在術式の語だけ追加vectorを保持します。入力されていない全数値80MBを初回から常駐させる設計へ戻していません。

Node 24.21.0/Windows・ローカルファイル・GC snapshot参考値では、cold初期化125.40→295.96ms、完了heap11,399,200→35,673,528B、process RSS87,240,704→135,254,016Bでした。入力索引分のheapは増えます。Node値はスマホ実測ではなく、Cache管理領域・HTTP overhead・実networkを含みません。warm、rare2語、全snapshotと測定条件は [KOTODAMA-DATA.md](KOTODAMA-DATA.md) と `test-results/input-restoration/kotodama-comparison.json` に記録します。

使用済み区画はofflineでも再利用します。未取得の既知語は「GloVeにない語」と誤分類せず、通信／写本不足で失敗します。manual refreshが以後の区画Cache利用を無効化しないこと、入力の消去・変更等で非同期準備中の術式を入れ替えないこともテストします。

## SCOWL索引の旧／新

旧起動はraw6,874,688Bを取得してsplit/Set/Map・n-gramを生成し、72,959,127BのJSONをCacheへ保存しました。新起動はNode事前生成のgzip圧縮binary6,691,687Bとmetadata1,406Bを読みます。巨大JSON生成・serialize/cache保存を除去し、gzipはopaque `.bin` とmetadataの `compression: gzip` で明示します。

486,609語、719 bigram、12,022 trigram、9,501,320 postings、signature `v2-43ck0-1c3vyw6`、禁止語除外、補正順位は全一致です。coreの変更はcountsのtyped array受理2行だけです。decoded countは0.97MBだけ独立コピーし、17.88MBの展開bufferを保持し続けないようにしています。posting Uint32は38,005,280Bを共有します。新索引読取り成功後だけ旧辞書専用Cache約79.83MBをbest-effort削除します。

Nodeでの旧生成+serialize2,139ms、新artifact読取り+hash+gunzip+decode422ms等は参考計測です。範囲・時点が完全に同じではないため、厳密なmobile速度比較として扱いません。[索引形式・検証文書](OCR-VOCABULARY-INDEX.md) に詳細を残しています。

## runtime integrityとWorker

- OCR detection ONNX: 4,745,517 bytes +固定SHA-256。
- OCR recognition ONNX: 10,822,323 bytes +固定SHA-256。
- OCR dictionary: 26,249 bytes +固定SHA-256。
- 事前OCR索引: 圧縮6,691,687 bytes +固定SHA-256。
- GloVe共通／補助／索引: metadataのbyte数/SHA-256を確認。

自前ModelCacheの3OCR資材は保存・使用前に増分SHA-256で検証します。HTTP Content-Lengthではなくdecoded body bytesを確認します。検証用巨大ArrayBufferを追加せず、hash状態は固定サイズです。Response cloneのteeで既存chunkが滞留することはあり、完全zero-copyとは主張しません。Workerは既存ArrayBufferをそのままsessionへ渡します。

壊れたCacheはevict→1回fresh、不正network bodyはCache保存しません。RangeError/Abort/WASM/メモリ失敗をretryへ変えません。Embeddingはrevision固定を維持し、Transformers.js内部cacheへ侵入しません。Worker terminate、AbortController、OpenCV解放、Structure→OCR→resource release→Embeddingの順序を維持します。

## CI/E2E・第三者表示・実機

手動E2Eを維持し、週1回（毎週月曜03:00 JST、日曜18:00 UTC）へ追加しました。毎PRでは実行せず、concurrency、npm Cache、固定revisionのNodeモデルdisk Cacheを使用します。Node専用の公開Cache API adapterでbrowser I/Oだけを適応し、同じWASM・revision・q8・計算を使います。通常CIとdist buildは維持します。

magia-circle.htmlの表示は「gutenye/ocr由来のOCRアルゴリズム・共有実装」とし、runtime importと実装由来を分けました。モデル・辞書の利用条件をMITとまとめて断定しません。

iPhone Safari/Android Chromeの実機は**未確認**です。カメラ許可・拒否、撮影解析、連続3回、画面ロック復帰、low-memory、自由入力・候補フィルタと測定テンプレートは [MOBILE-TEST-CHECKLIST.md](MOBILE-TEST-CHECKLIST.md) へ記録します。

ライセンスの残る確認は、OCR変換weightと版の対応、SCOWL生成版／通知の対応、頻度・人名の上流条件、GeoNamesミラーの変換履歴です。[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) の慎重な記述とライセンス全文を維持し、事前索引化や入力拡張を確認済みの根拠にしていません。

## 検証記録

- 旧14goldenと新自由入力8golden、全allowlist、候補/入力/禁止/人名/地名の分類、rawGloVe全20,000,000 Float32値一致、66入力ファイル再生成byte一致。
- 全旧OCR索引word/count/posting/ranking一致、gzip/meta再生成byte一致。
- ModelCache Node crypto対照、SHA境界、破損/partial/同長改変/圧縮header差、未検証modelをsessionへ渡さない実Workerテスト。
- 21 offlineスイート（既存18を維持）、6重量E2E確認、native画像基準との全項目差分0、Worker pipelineの基準比較成功。
- runtime model cache専用testと実Worker終了、キャッシュした固定モデルの再利用。
- 実Chromiumで `anemometer + wind` がgravity / 78.7% / 133。候補外の入力が計算できることを確認。
- 最終 `npm ci / npm test / npm run check / npm run build / npm run verify:external-assets -- --models` はすべて成功。外部資材6件のbytes/SHAも一致しました。
- 実Chromiumの画像解析とバッチを比較し、表示差分0・diagnostics差分0。画像から解析し、手入力で認識文字列を代用していません。
- 未実行・未確認: 実スマホ、カメラ、screen lock/low-memory実機、将来の週次GitHub実行。自動/desktop/Nodeの結果で確認済みにしません。

最終npm ci時点のauditはdev依存にmoderate 5件（同一の [sprintf-js advisory GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) と依存連鎖）、high/critical 0件です。`npm audit --omit=dev` は0件でした。該当経路はonnxruntime-nodeのinstall/proxy用global-agent配下で、調査したformat呼出しは固定文字列でした。これは全利用経路の安全性の断定ではありません。修正版がなく、auditの提案はTransformers.jsのmajor変更を伴うため、今回のモデル・計算互換性を維持し、強制更新していません。

## 変更ファイル一覧

- `.gitattributes`
- `.github/workflows/image-e2e.yml`
- `README.md`
- `THIRD_PARTY_NOTICES.md`
- `assets/data/external-assets.json`
- `assets/data/kotodama-input.index.json`
- `assets/data/kotodama-input.meta.json`
- `assets/data/ocr-vocabulary-index.2b25ea8cce3f046a.bin`
- `assets/data/ocr-vocabulary-index.meta.json`
- `assets/js/kotodama-app.js`
- `assets/js/kotodama-data.js`
- `assets/js/kotodama-input-vectors.js`
- `assets/js/kotodama-rendering.js`
- `assets/js/kotodama-scoring.js`
- `assets/js/magia-circle-app.js`
- `assets/js/magia-circle-ocr-worker.js`
- `assets/js/model-cache.js`
- `assets/js/ocr-vocabulary-index.js`
- `assets/js/runtime-dependencies.js`
- `assets/js/spell-ocr.js`
- `assets/js/streaming-sha256.js`
- `docs/IMAGE-OUTPUT-COMPARISON.md`
- `docs/INPUT-RESTORATION-REVIEW.md`
- `docs/KOTODAMA-DATA.md`
- `docs/MOBILE-TEST-CHECKLIST.md`
- `docs/OCR-VOCABULARY-INDEX.md`
- `fixtures/kotodama/candidate-allowlists.json`
- `fixtures/kotodama/input-baseline.json`
- `magia-circle.html`
- `package.json`
- `scripts/benchmark-kotodama-data.mjs`
- `scripts/build-kotodama-input-vectors.mjs`
- `scripts/build-ocr-vocabulary-index.mjs`
- `scripts/generate-kotodama-input-golden.mjs`
- `scripts/kotodama-lexicon.mjs`
- `scripts/load-ocr-vocabulary-index.mjs`
- `scripts/run-tests.mjs`
- `tests/model-file-cache.mjs`
- `tests/test-analysis-worker-pipeline.mjs`
- `tests/test-image-outputs.mjs`
- `tests/test-kotodama-app.mjs`
- `tests/test-kotodama-data.mjs`
- `tests/test-kotodama-input-vectors.mjs`
- `tests/test-kotodama-lexicon.mjs`
- `tests/test-kotodama-scoring.mjs`
- `tests/test-model-cache.mjs`
- `tests/test-model-file-cache.mjs`
- `tests/test-ocr-vocabulary-index.mjs`
- `tests/test-ocr-worker-client.mjs`
- `tests/test-ocr-worker-lifecycle.mjs`
- `tests/test-runtime-dependencies.mjs`
- `tests/test-spell-ocr.mjs`
- `assets/data/kotodama-input-00.f32` ～ `kotodama-input-63.f32`（64分割、全件追加）
