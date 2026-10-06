# OCR一般語彙の事前索引

SCOWL由来の一般語辞書と禁止語辞書から、開発時に `SpellOcrCore.createVocabularyNgramIndex` をそのまま使って索引を生成します。`vocabularySignature`、禁止語の除外、単語順、bigram/trigramと各postingの順序は従来のv2索引と同一です。OCR補正のスコア計算や候補の順位を変更しません。

```sh
npm run build:ocr-vocabulary-index -- --download
# 取得済み資料を使う場合
npm run build:ocr-vocabulary-index -- --source-dir .tmp/kotodama-build
```

取得元のcommit、元資料のbytes/SHA-256、format version、単語数、signature、展開前後のbytes/SHA-256を `assets/data/ocr-vocabulary-index.meta.json` に記録しています。取得元SHAが一致しない場合は生成を中止します。gzipはlevel 9、timestampなしで生成し、同じ資料とNode/zlibでbyte-for-byte再生成できます。配布ファイル名にSHA-256の先頭16桁を含めるため、内容が変わった索引を古いCache Storageと混同しません。

配布ファイルの拡張子は `.bin`、内容はgzipです。metadataの `compression: "gzip"` を確認して明示的に展開します。`.gz` を静的ホストがHTTP `Content-Encoding` として透明展開する可能性を避け、hash検証と展開の対象byteを明確にしています。

## 格納形式 v1

gzipを展開したバイナリは以下の順序です。全整数はlittle-endianです。

1. ASCII magic `OCRI`（4 bytes）。
2. format version `1`（Uint32）。
3. UTF-8 JSON headerのbyte長（Uint32）。
4. JSON header: 元索引の `version: 2`、`signature`、`words`、`forbiddenSize` と、元の順序の `bigrams` / `trigrams`。各gramは `[gram, posting数]` として保存します。
5. 各単語のbigram数（単語数分のUint8）。
6. 各単語のtrigram数（単語数分のUint8）。
7. headerのbigram順、続いてtrigram順のposting。各listはword IDの差分をunsigned base-128 varintで格納します。最初のIDは0からの差分、以降は直前IDからの正の差分です。各byteの下位7 bitが値、最上位bitが継続フラグです。

ブラウザーはDecompressionStreamで展開し、headerを読み、postingを一つのUint32Arrayへ復元します。各gramはそのsubarrayを参照します。元の単語からgramを作り直しません。count配列だけは合計973,218BのUint8Arrayへコピーし、約17.88MBの展開済みbufferを索引から保持しないようにします。補正処理は通常Arrayとtyped arrayのcountを同じように受け取り、同じ計算を行います。

decoderはversion、header長、単語の形式/昇順、gramの重複/長さ、count範囲、posting数、ID範囲/単調増加、varintのoverflow/余分な上位0、truncation、末尾の余分なbytesを検証します。word数100万、posting数3000万、展開byte数100MBの上限を設けています。配布gzipは使用・Cache保存の前に共通ModelCache validatorで期待byte数とSHA-256を確認します。

## 起動とキャッシュ

旧処理はraw辞書2件の取得、split、Set/Map構築、全単語のgram生成、約73MBのJSON生成、Cache Storage保存でした。新処理は小さなmetadataと完成済みgzip索引の取得、検証、展開、posting復元だけです。完成済みgzipとmetadataだけをCache Storageに保存します。metadataのnetwork取得が失敗した場合は保存済みmetadataを利用します。hash不一致のCache項目はModelCacheが破棄して再取得し、不正なnetwork応答は保存しません。Cache保存権限がない場合も、その場の読み込みを続けられます。

新索引の読取り成功後、旧 `magia-circle-kotodama-dictionaries-v1` namespaceをbest-effortで削除します。旧raw辞書と巨大JSONの79,833,815B分が残り続けることを防ぎます。削除拒否は解析を妨げません。OCRモデル、Embeddingモデル、コトダマギアの他のCache namespaceには触れません。

起動時の準備確認後は索引を解放し、解析時に圧縮Cacheから読み直します。解析終了後も索引・correctorを保持しません。永続的なメモリ常駐を増やさないためです。対応ブラウザーのDecompressionStreamが使えない場合は補正索引の読み込み失敗として扱い、raw辞書生成へ戻りません。

| 項目 | 従来 | 事前索引 |
| --- | ---: | ---: |
| 一般語辞書+禁止語 raw bytes | 6,874,688 | runtime取得なし |
| 補正対象語 | 486,609 | 486,609 |
| bigram / trigram | 719 / 12,022 | 719 / 12,022 |
| vocabularySignature | v2-43ck0-1c3vyw6 | v2-43ck0-1c3vyw6 |
| JSON索引 bytes | 72,959,127 | runtime生成なし |
| gzip配布 bytes | — | 6,691,687（metadataは別途） |
| 展開済みbinary bytes | — | 17,882,262 |
| postingのUint32 data bytes | 通常Number配列 | 38,005,280 |
| count data bytes | 通常Number配列 | 973,218（独立したbuffer） |
| Cacheの本体bytes | raw+JSON: 79,833,815 | gzip: 6,691,687（metadataは別途） |

これは配布ファイルの実bytesと索引のdata領域です。HTTP圧縮、Cache内部管理領域、単語文字列、Map/Set、DecompressionStreamの内部領域などを含む実転送量/実heapではありません。ブラウザーはdecoded buffer、posting buffer、words/Mapなどを一時的に保持します。モバイルの実測値ではありません。実機確認は `MOBILE-TEST-CHECKLIST.md` へ記録してください。

開発PCのNode `--expose-gc` による一回の参考計測では、旧索引生成+JSON serializeが2,139ms、GC後heap 208,565,120B / RSS 478,515,200Bでした。count bufferを独立させた新ローカルartifactのhash+stream gunzip+binary decodeは422ms、event loopを一度進めたGC後heap 27,908,560B / RSS 154,677,248B / ArrayBuffer 45,882,288Bでした。旧処理はraw textを事前にread済み、新処理はlocal artifactのreadを含みます。ネット通信、Cache書込、correctorのMap構築を含まず、計測タイミングの異なる一回ずつのNodeプロセスであり、比較の厳密なbenchmarkではありません。ブラウザー/スマートフォンの起動時間やpeak memoryを表す数値として扱わないでください。

## 検証

`test-ocr-vocabulary-index.mjs` は小fixtureの旧索引と復元後の全word/gram/count/postingの一致、生成物provenance、cold/warm/offline Cache、破損Cache、不正download、保存不可Cache、形式破損を確認します。画像E2EとNodeバッチも同じcodec/完成済み索引を使い、既存画像goldenとの比較を維持します。

出典と再配布条件の確認は `THIRD_PARTY_NOTICES.md` および既存第三者ライセンス資料を参照してください。事前索引化をライセンス確認完了の根拠とはしていません。
