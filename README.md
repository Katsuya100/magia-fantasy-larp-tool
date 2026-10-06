# マギア・ファンタジー LARPツール

描いた陣から魔法を顕現させる「マギアサークル」と、英語の言霊を足し引きして魔法を作る「コトダマギア」を収録した、ブラウザ向けのファンタジーLARPツールです。サーバー側の推論サービスは不要で、GitHub Pagesなどの静的ホスティングから利用できます。

[公開ページ](https://katsuya100.github.io/magia-fantasy-larp-tool/) / [コトダマギア](kotodama.html) / [マギアサークル](magia-circle.html)

## 遊べること

- **コトダマギア**: `fire + heat - reporting` のような魔導式を刻み、意味の共鳴から相と顕現魔力を求めます。偶然の墨、写本の導き、近似解、反転術式、顕現録を利用できます。
- **マギアサークル**: 画像を選ぶかカメラで撮影し、外円・内円・環の呪文・紋を読み取ります。相と紋の全候補の割合、威力と内訳を表示します。処理はStructure → OCR →画像資源の解放 → Embeddingの順で行い、重いWorkerを重ねない設計です。

世界観・用語・計算式を維持しています。コトダマギアの入力と候補は別レイヤーです。

- **入力**: GloVe 6B 50dの入力外典400,000語を搭載し、禁止語だけを内容上の理由で拒否します。人名・地名・珍しい語だからという理由で入力を拒否しません。英数字・underscoreと+/-の従来構文は維持します。構文で一語として直接表せる語は327,245語、GloVeにある禁止語195語を除いた327,050語がそのまま単語として使用可能です。
- **候補出力**: 一般語辞書、frequency、禁止語、人名・地名除外、元のallowlistを通した**2,516語**だけです。近似解・反転・欠片・偶然の墨・写本に使います。

40,146語の常駐軽量ベクトルは保持し、残り359,854語の入力補助を64区画へ分割しています。`anemometer` や `quasar` のような候補外の語も、自分で知っていれば入力できます。全数値配列80MBを初回に取得・常駐させず、必要な入力区画だけ読み、使用語の50次元だけ保持します。

## ブラウザとカメラ

WebAssembly/SIMD、Worker・Module Worker、Canvasが利用できるChrome、Edge、Firefox、Safariを対象にしています。Cache API/IndexedDBが制限されていても、通信ができれば解析と遊戯を進められます。小さいメモリの端末では解析に失敗することがあり、メモリ不足・RangeError・WebAssembly RuntimeErrorを再試行の対象にしません。一時的なモデル取得失敗だけ、既存の上限内で再試行します。

今回の確認環境はWindows/ChromiumとNode.js 24です。390px幅の確認は実機テストではありません。[実機チェックリスト](docs/MOBILE-TEST-CHECKLIST.md)に端末・版・転送量・時間・連続解析を記録できます。Android/iPhoneの実機、Safari/Firefoxでの性能・カメラ動作は追加確認が必要です。対応対象は全端末の動作保証を意味しません。

カメラは「写し絵を撮影」を押したときだけ権限を要求します。HTTPSまたはlocalhost等の安全なコンテキストが必要です。許可しなくても画像の選定で利用できます。

## 初回ロード・外部通信

| アプリ | 取得するもの |
| --- | --- |
| コトダマギア | 同じ静的サイトの常駐軽量GloVe、候補lexicon、全入力索引とmetadata、初回 **12,307,658 bytes（約12.31MB）**。未取得の入力語は該当f32区画だけ追加（1,103,000～1,150,000 bytes）。全補助まで取得しても84,278,458 bytes。ZIPや生の人名・地名辞書は取得しません |
| マギアサークルの準備 | 固定commitのSCOWL／禁止語からNodeで事前生成した圧縮OCR索引とmetadata（6,693,093 bytes）。ブラウザでは元text取得・n-gram生成・巨大JSON保存をしません |
| マギアサークルの解析 | jsDelivrから固定版のONNX Runtime Web、OpenCV.js、js-clipper、Transformers.jsとWASM資材、PP-OCRv4モデル2件とOCR辞書（約15.59MB）。Hugging Faceから固定revisionの `Xenova/all-MiniLM-L6-v2` q8モデル（約22.97MB）、tokenizer/config等。ライブラリ・WASMの容量は上記モデル容量とは別です |

このアプリのコードは、画像・OCR結果・呪文を外部の解析サーバーへ送信する処理を持ちません。Canvas、OCR、画像解析、Embeddingをブラウザ内で実行します。一方、モデル・ライブラリ・辞書を外部から取得するHTTP通信は行います。この取得通信と、ユーザーの画像を送信することは区別してください。

外部URL・version・モデルオプションは [runtime-dependencies.js](assets/js/runtime-dependencies.js)、元データとhashは [external-assets.json](assets/data/external-assets.json) と `assets/data/*.meta.json` に記録しています。OCR detection/recognition ONNX・OCR辞書はruntimeでもdecoded byte数と増分SHA-256をCache保存・session利用前に検証します。Embeddingはrevision固定を維持し、Transformers.js内部cacheへ侵入する追加検証は行いません。

旧方式のZIP862,182,753 bytesへ戻していません。前回40,146語版は8,551,008 bytes、自由入力復元後は初回12,307,658 bytesと必要区画の追加取得です。配布方式A/B/Cの比較、Cache payloadとNode heap/RSS・初期化時間の比較は [軽量辞書の設計と計測](docs/KOTODAMA-DATA.md)、OCR索引は [索引の形式と検証](docs/OCR-VOCABULARY-INDEX.md) に記しています。ファイルpayloadと実ネットワーク／モバイル性能は区別しています。

## キャッシュ

コトダマギアは常駐辞書・候補索引・全入力索引とmanifest3件をCache APIへ保存します。通常はmanifest3件で更新を確認し、数値配列と索引は控えから読みます。入力補助区画は使用時だけ保存します。通信が一時的に失敗しても、完成済みmanifest・索引・使用済み区画の控えがあれば同じ語を利用できます。未取得の既知語をofflineで入力した場合は「外典に名のない語」ではなく、通信／写本不足として表示します。全40万語の全区画が初回にcacheされるわけではありません。破損cacheは捨て、1回の新規取得を行います。キャッシュ保存・削除の拒否やquota不足は遊戯を妨げません。

初回移行時に旧GloVeのIndexedDB分冊ZIP/TXTと旧頻度・人名・地名cacheを削除します。旧ページを別タブで開いているとDB削除が保留になることがあるため、そのタブを閉じて次回起動してください。マギアサークルは検証済み圧縮索引を別Cacheへ保存し、新索引を読めた後に旧raw辞書・巨大JSONの専用Cacheを削除します。モデルCacheとlocalStorage診断記録は別に維持します。

- コトダマギアの辞書を開き直す: 頁末の「外典の控えを灰に戻し、扉をひらく」を押す。
- 両アプリの控えを全て削除する: ブラウザのサイト設定から当サイトの保存データを消す。開発者ツールのApplication/Storage等からCache Storage、IndexedDB、localStorageも確認できます。モデルは次回取得され、診断記録も消えます。

Service Workerによるサイト全体のオフライン配信は実装していません。辞書cacheがあっても、HTMLやアプリコードを取得できない状況での新規ページ起動までは保証しません。

## 開発と静的公開

Node.js 24で開発・検証しています。

```sh
npm ci
npm run serve
```

`http://127.0.0.1:8765/` を開きます。LinuxのCPU/WASM用インストールでは `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci` とすると、不要なCUDA資材の取得を避けられます。社内CA等を使う環境では `NODE_OPTIONS=--use-system-ca` を設定してください。TLS検証を無効化する必要はありません。

HTML/`assets/` をそのままGitHub Pagesのリポジトリルートから静的公開できます。別の公開先に配布物を用意する場合は次を実行します。

```sh
npm run build
```

`dist/` にHTML、assets、ライセンス表示をコピーします。`.openai/hosting.json` の `static.directory: dist` と一致します。distは生成物なのでGitへ追加しません。モデルや辞書の再生成は公開ビルドの必須処理ではなく、生成済み軽量資材を利用します。

## テスト

```sh
npm test
npm run check
npm run build
```

`npm test` は既存18本を維持し、入力分離・事前OCR索引・Node model cacheの3本を追加した21本のネットワーク不要unit/integrationスイートです。威力・相・画像pipeline、OCR retry方針とcleanup、Worker handshake/client、model cache、診断、結果描画、外部依存固定情報、軽量辞書生成・ロード・語彙・旧コトダマギアの14術式と新しい自由入力8術式との一致を確認します。`npm run check` はアプリ・Worker・開発スクリプト・テスト・HTML内scriptの構文確認です。

通常CIは `npm ci`、上のテスト、構文確認、静的buildを行います。npmのパッケージ取得（同梱OCRモデルを含む）は必要ですが、テスト実行でEmbeddingモデルを取得しません。大量のモデルを使う画像E2Eは通常CIに含めません。

### 画像・実Workerの重い確認

```sh
npm run test:image-outputs -- assets/images/sample.png
npm run test:spell-ocr -- assets/images/sample.png
npm run test:e2e
```

画像ファイルを直接入力し、認識文字列を手入力で代用しません。`test:e2e` は画像出力、OCR、実Workerの複数回実行・解放、完全pipeline、検出stress、画像幾何の確認をまとめます。初回はモデル・CDN資材の取得が必要で、CPU・メモリも使います。GitHub Actionsの **Image and Worker E2E (models required)** は手動実行と週1回（月曜03:00 JST）の実行です。毎PRでは動かさず、npmと固定revisionのモデルをcacheし、同じrefの重複実行を抑えます。Node専用cache adapterを利用し、browser/WASMと同じ版・q8・数値処理を維持します。

[ブラウザとバッチの比較手順](docs/IMAGE-OUTPUT-COMPARISON.md) / [自由入力復元と追加修正の報告](docs/INPUT-RESTORATION-REVIEW.md) / [前回の修正記録](docs/REVIEW-CHANGES.md)

### 辞書再生成・外部資材の照合

```sh
npm run build:kotodama-vectors -- --download
npm run build:kotodama-lexicon -- --download
npm run build:kotodama-input-vectors
npm run build:ocr-vocabulary-index
npm run benchmark:kotodama
npm run verify:external-assets
npm run verify:external-assets -- --models
```

GloVe取得は開発用Nodeだけで行い、固定ZIPの50次元entryをHTTP Rangeで取得してhashを検証します。巨大原本は `.tmp/` に置き、Gitへ追加しません。既に取得済みなら `--download` を省略して同じ入力から再生成できます。詳細は [KOTODAMA-DATA.md](docs/KOTODAMA-DATA.md) を参照してください。外部資材の照合は明示的な保守作業であり、通常CIからは実行しません。

## 配置とライセンス

- `assets/js/` / `assets/css/`: アプリと共有ロジック。
- `assets/data/`: 軽量辞書・語彙と由来・外部資材台帳。
- `assets/licenses/`: 第三者のライセンス・著作権表示。
- `fixtures/`: 比較用の固定JSON。`benchmarks/`: 過去の計測資料。
- `test-results/`: 今回実行した計測やE2Eログ（Git対象外）。`.tmp/`: 大きな元データ等（Git対象外）。

本プロジェクトのライセンスは [LICENSE](LICENSE)、第三者ライブラリ・モデル・辞書の条件は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。GloVeコードのApache-2.0と、今回配布する学習済みベクトルのPDDL 1.0を区別しています。OCR変換weightの対応、SCOWL生成版、頻度/人名データの上流条件、GeoNamesミラーの変換履歴は追加確認事項として明記しています。
