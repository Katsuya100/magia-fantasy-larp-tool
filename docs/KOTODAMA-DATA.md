# コトダマギアの軽量辞書

## 生成と責務

ブラウザは `kotodama-vectors.f32`、`kotodama-vectors.words.json`、`kotodama-lexicon.json` と2件のmetadataだけを取得します。GloVe ZIP、元の50次元テキスト、人名・地名等の大きな原本は開発時に処理します。

- `kotodama.html` / `assets/css/kotodama.css`: HTMLと元のスタイル。
- `kotodama-app.js`: 初期化、イベント、busy/failure状態、顕現と写本・偶然の墨の制御。
- `kotodama-attributes.js`: 元の相の名前・属性語・world lore。
- `kotodama-vector-store.js`: Float32格納。読み込んだバッファを再利用。
- `kotodama-data.js`: 同一サイトからの取得、hash・サイズ・形式の検証、cacheと旧cacheの移行。
- `kotodama-scoring.js`: 元のベクトル演算、属性判定、近傍・反転・術式の計算。
- `kotodama-rendering.js`: 相・近傍・履歴・書架の表示。外部語と履歴はescape、例外と入力語の表示はDOM/textContent。

app以外はappをimportせず、循環依存を作りません。生成スクリプトはブラウザへimportしません。

## 再現方法

Node.js 24で次を実行します。

```sh
npm run build:kotodama-vectors -- --download
npm run build:kotodama-lexicon -- --download
npm test
```

固定した公式Hugging FaceのGloVe ZIPから50次元entryだけをHTTP Range（69,182,505 bytes）で取得・Nodeのzlibで展開します。サーバーが正しい206/Content-Rangeを返さない場合やhashが異なる場合は停止し、ZIP全体取得へfallbackしません。ローカル原本は `.tmp/kotodama-build/` へ保存します。

再取得せず生成する場合は `--download` を省略します。`--source-dir <directory>`、`--source <glove.6B.50d.txt>`、`--output-dir <directory>`、`--input-rank-limit <rank>` も指定できます。lexicon側は `--source-dir` / `--words` / `--output-dir` を指定できます。語の選択条件を変更した場合は両方の生成物と基準テストを合わせて更新してください。

生成日時のような変動する値を生成物に入れず、固定source revision、input SHA-256、生成方法、選択条件とoutput SHA-256をmetadataへ残します。同じ入力・設定からは同じバイト列になります。`.gitattributes` にJSONのLFとf32のbinary属性を指定し、Windowsの改行変換でhashが変わることを防いでいます。

## 収録範囲と形式

- GloVe元順の先頭50,000語のうちSCOWL系辞書と交わる語。
- それに加え、元のfrequency parserが採る4,324語を全て保持（先頭50,000語の外も保持）。
- 全相の真名と関連属性語85語を必須として保持。
- 合計40,146語、50次元、Float32LE。

数値は元のGloVeをFloat32へ変換した値と全2,007,300要素で一致します。旧VectorStoreもFloat32で格納していたため、保持語の意味ベクトルや計算精度は変わりません。標準のFloat32列と別JSONの語順・次元情報という単純な形式を用い、独自圧縮・複雑なheader/parserを導入しません。

HFの50d原本には400,000語に加えて最後に `<unk>` があり、実際には400,001行です。旧ブラウザの40万語上限でもこの最後のentryは使わず、軽量辞書にも含めません。

近傍候補は元のplain-English、SCOWL、頻度、禁止語、人名・地名ゲートとordinary-word allowlistを保持して開発時に生成します。現在の固定sourceで候補は2,516語です。全原本400,001語から同じゲートで選んだ候補と、軽量辞書から選んだ候補の順序まで一致することを確認しています。

地名は旧コードのfallbackにも使われていた固定GeoNames JSON写本とNatural Earthから生成します。日々変わるGeoNames ZIPへのブラウザ取得は廃止しました。旧ライブ辞書や以前のcacheとは収録時点が異なり得るため、全ての過去の候補表示との同一性までは主張しません。ゲート・計算式を変更せず、今回の固定入力に対して候補を欠落させないことを確認しています。

元の40万語全てを入力できる保証はありません。軽量化のため、入力可能語彙を上記範囲に限定します。近傍候補・属性核と一般的な意味遊びの語彙を優先した選択です。

## 転送・cache・メモリ

2026-10-06の生成物。MBは10^6 bytesです。

| 項目 | 旧方式 | 新方式 |
| --- | ---: | ---: |
| GloVeに関係する初回payload | ZIP 862,182,753 bytes（他の辞書は別途） | 辞書・lexicon・2 manifest 8,551,008 bytes |
| ベクトル本体 | 生テキスト171,350,515 bytesをZIPから展開 | Float32LE 8,029,200 bytes |
| 語の索引 | テキストから実行時生成 | words JSON 413,114 bytes |
| 候補索引・由来 | 大きな各原辞書をブラウザで取得・加工 | lexicon JSON 102,960 bytes、manifest 5,734 bytes |
| 保存payload概算 | ZIP+TXTだけで1,033,533,268 bytes、さらに語彙cache | 約8.55MBとCache API管理領域。完成manifestはchecksum付きの控えで保存 |
| VectorStoreの数値配列 | 80,204,800 bytes（上限40万語+予約分） | 8,029,200 bytes、取得バッファを再利用 |
| モバイルの総メモリpeak/起動時間 | 未実測 | 未実測 |

ZIPと新しい辞書一式の比較で853,631,745 bytes削減、約99.01%減です。数値配列だけなら約89.99%減ですが、語のMap/Set、fetch/crypto/cacheの一時バッファ、JS engine、Canvas、ブラウザ自身のメモリは別に必要です。転送値は未圧縮ファイルpayloadで、HTML/JS/CSS、HTTP overhead、圧縮配信の効果は含みません。

`npm run benchmark:kotodama` は、共有loaderをローカルファイルのfetch adapterで計測します。今回のWindows/Node 24.21.0では133.86ms、10msサンプルで観測したprocess RSS最大107,212,800 bytesでした。測定前RSS48,435,200 bytes、完了時97,558,528 bytes、完了時ArrayBuffer8,691,833 bytesです。これはNode/一時fetchバッファ/GCを含む値で、端末のネットワーク時間・ブラウザ起動時間・モバイルのpeakではありません。瞬間的peakを取り逃す可能性もあります。ログは `test-results/review/kotodama-loader.json` に出力します。

## 検証

- generator: 同じ入力・設定のbyte一致、必須属性、重複、50次元、不正行/非有限値、source hash不一致。
- 公式sourceを再取得して別directoryへ生成し、words/f32/metadataの全byte一致を確認。
- 保持した全Float32要素の元テキストとの一致、元の全近傍候補の保持を確認。
- loader: hash/size/schema、破損cacheを1回再取得、cache拒否、quota、手動refresh、旧cache移行、完成済み辞書のoffline fallback、memory/WASM errorの非retry。
- source commit `89e80a1` の元HTMLから作った14術式の基準値と、相・生のcosine・近傍・反転・顕現魔力・失敗表示の一致。
- 390px幅のブラウザで表示と初期術式の235/86.6%を確認。

軽量化の変更はマギアサークルの共有 `power-calculation.js`、`attribute-scoring.js`、画像計算式、OCR精度定数へ入れていません。マギアサークルの大きなOCR補正索引も既存の仕様を維持しており、そのモバイルmemory負担の削減は今後の別課題です。
