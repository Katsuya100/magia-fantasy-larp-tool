# マギア・ファンタジー LARPツール

描いた陣から魔法を顕現させる「マギアサークル」と、英語の言霊を足し引きして魔法を作る「コトダマギア」を収録した、ブラウザ向けのファンタジーLARPツールです。サーバー側の推論サービスは不要で、GitHub Pagesなどの静的ホスティングから利用できます。

[公開ページ](https://katsuya100.github.io/magia-fantasy-larp-tool/) / [コトダマギア](kotodama.html) / [マギアサークル](magia-circle.html)

## 遊べること

- **コトダマギア**: `fire + heat - reporting` のような魔導式を刻み、意味の共鳴から相と顕現魔力を求めます。偶然の墨、写本の導き、近似解、反転術式、顕現録を利用できます。
- **マギアサークル**: 画像を選ぶかカメラで撮影し、外円・内円・環の呪文・紋を読み取ります。相と紋の全候補の割合、威力と内訳を表示します。処理はStructure → OCR →画像資源の解放 → Embeddingの順で行い、重いWorkerを重ねない設計です。

世界観・用語・計算式を維持しています。コトダマギアの軽量辞書には40,146語を収録します。旧40万語の全てを入力できるわけではなく、収録外の語は「外典に名のない言霊」と表示します。属性語85語と元の頻度候補辞書4,324語は全て保持し、固定辞書から求めた近傍候補2,516語も保持しています。

## ブラウザとカメラ

WebAssembly/SIMD、Worker・Module Worker、Canvasが利用できるChrome、Edge、Firefox、Safariを対象にしています。Cache API/IndexedDBが制限されていても、通信ができれば解析と遊戯を進められます。小さいメモリの端末では解析に失敗することがあり、メモリ不足・RangeError・WebAssembly RuntimeErrorを再試行の対象にしません。一時的なモデル取得失敗だけ、既存の上限内で再試行します。

今回の確認環境はWindows/ChromiumとNode.js 24です。390px幅でコトダマギアの表示を確認しました。Android/iPhoneの実機、Safari/Firefoxでの性能・カメラ動作は追加確認が必要です。対応対象は全端末の動作保証を意味しません。

カメラは「写し絵を撮影」を押したときだけ権限を要求します。HTTPSまたはlocalhost等の安全なコンテキストが必要です。許可しなくても画像の選定で利用できます。

## 初回ロード・外部通信

| アプリ | 取得するもの |
| --- | --- |
| コトダマギア | 同じ静的サイトの軽量GloVe辞書・語彙索引・由来情報、合計 **8,551,008 bytes（約8.55MB）**。ブラウザからGloVe ZIPや生の人名・地名辞書は取得しません |
| マギアサークルの準備 | 固定commitの禁止語とSCOWL系辞書（約6.87MB）、OCR補正索引を端末内で生成 |
| マギアサークルの解析 | jsDelivrから固定版のONNX Runtime Web、OpenCV.js、js-clipper、Transformers.jsとWASM資材、PP-OCRv4モデル2件とOCR辞書（約15.59MB）。Hugging Faceから固定revisionの `Xenova/all-MiniLM-L6-v2` q8モデル（約22.97MB）、tokenizer/config等。ライブラリ・WASMの容量は上記モデル容量とは別です |

このアプリのコードは、画像・OCR結果・呪文を外部の解析サーバーへ送信する処理を持ちません。Canvas、OCR、画像解析、Embeddingをブラウザ内で実行します。一方、モデル・ライブラリ・辞書を外部から取得するHTTP通信は行います。この取得通信と、ユーザーの画像を送信することは区別してください。

外部URL・version・モデルオプションは [runtime-dependencies.js](assets/js/runtime-dependencies.js)、元データとhashは [external-assets.json](assets/data/external-assets.json) と `assets/data/*.meta.json` に記録しています。

旧方式のZIP **862,182,753 bytes（約862MB）** と比較すると、新しい辞書一式は **約99.01%減、約853.63MB削減**です。これはファイルの未圧縮payload比較で、HTML/JS/CSS・HTTPヘッダー等を含みません。再生成・メモリの概算・計測の限界は [軽量辞書の設計と計測](docs/KOTODAMA-DATA.md) に記しています。

## キャッシュ

コトダマギアは検証済みの軽量辞書3件とmanifest2件をCache APIへ保存します。通常はmanifest2件で更新を確認し、大きな辞書は控えから読みます。通信が一時的に失敗しても、完成済みmanifestと辞書の控えがあれば利用できます。破損cacheは捨て、1回の新規取得を行います。キャッシュ保存・削除の拒否やquota不足は遊戯を妨げません。

初回移行時に旧GloVeのIndexedDB分冊ZIP/TXTと旧頻度・人名・地名cacheを削除します。旧ページを別タブで開いているとDB削除が保留になることがあるため、そのタブを閉じて次回起動してください。マギアサークルのモデル・辞書・OCR補正索引は別のCache API、診断記録はlocalStorageに保存されます。

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

`npm test` は18本のネットワーク不要のunit/integrationスイートです。威力・相・画像pipeline、OCR retry方針とcleanup、Worker handshake/client、model cache、診断、結果描画、外部依存固定情報、軽量辞書生成・ロード・語彙・旧コトダマギアの14術式との一致を確認します。`npm run check` はアプリ・Worker・開発スクリプト・テスト・HTML内scriptの構文確認です。

通常CIは `npm ci`、上のテスト、構文確認、静的buildを行います。npmのパッケージ取得（同梱OCRモデルを含む）は必要ですが、テスト実行でEmbeddingモデルを取得しません。大量のモデルを使う画像E2Eは通常CIに含めません。

### 画像・実Workerの重い確認

```sh
npm run test:image-outputs -- assets/images/sample.png
npm run test:spell-ocr -- assets/images/sample.png
npm run test:e2e
```

画像ファイルを直接入力し、認識文字列を手入力で代用しません。`test:e2e` は画像出力、OCR、実Workerの複数回実行・解放、完全pipeline、検出stress、画像幾何の確認をまとめます。初回はモデル・CDN資材の取得が必要で、CPU・メモリも使います。GitHub Actionsの **Image and Worker E2E (models required)** は手動実行用です。

[ブラウザとバッチの比較手順](docs/IMAGE-OUTPUT-COMPARISON.md) / [今回の変更と検証報告](docs/REVIEW-CHANGES.md)

### 辞書再生成・外部資材の照合

```sh
npm run build:kotodama-vectors -- --download
npm run build:kotodama-lexicon -- --download
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
