# Third-party notices

コード、学習済みモデル、辞書・地理データのライセンスを分けて記載します。ライセンス全文・著作権表示は [assets/licenses/](assets/licenses/) に同梱し、取得元とSHA-256を [sources.json](assets/licenses/sources.json) に記録しています。公開用 `npm run build` はこれらもコピーします。調査日: 2026-10-06。

## ブラウザのライブラリ

| 実際の利用 | 固定バージョン | 出典・ライセンス |
| --- | --- | --- |
| 文章Embedding Worker: Transformers.js | `@huggingface/transformers` 3.8.1 | [Hugging Face](https://github.com/huggingface/transformers.js)、Apache-2.0。jinja/tiny-invariant等の同梱コードのMIT表示も保持 |
| OCR Worker: ONNX Runtime Web | 1.30.0 | [Microsoft ONNX Runtime](https://github.com/microsoft/onnxruntime)、MIT。ThirdPartyNoticesも同梱 |
| Transformers.jsに同梱されたONNX Runtime Web | 1.22.0-dev.20250409-89f8206ba4 | 同上。OCR用と別のruntimeであり、NodeのEmbeddingバッチもこの組合せを使用 |
| OCRの幾何補正: OpenCV.js | `@techstark/opencv-js` 4.9.0-release.3 | [TechStark](https://github.com/TechStark/opencv-js)、Apache-2.0 |
| OCRの輪郭処理: js-clipper | 1.0.1 | [js-clipper](https://github.com/mathisonian/JsClipper)、Boost Software License 1.0。内包するTom WuのJSBN表示も保持 |
| OCRアルゴリズムの出典・Nodeバッチ | `@gutenye/ocr-node` 1.3.0 / `ocr-common` | [gutenye/ocr](https://github.com/gutenye/ocr)、ライブラリはMIT。ブラウザは本リポジトリのWorkerと共有OCRコードを実行し、ocr-browserを別途CDN importしていない |

`fflate` はブラウザから除去しました。GloVe取得・解凍は開発用Nodeスクリプトの標準 `node:zlib` で行い、ブラウザにZIPを送信しません。Node画像バッチの `sharp` はApache-2.0です。0.35.4へ統一し、依存するlibvips等の表示はnpm配布物のLICENSE/third-party noticesにも従います。

固定URL・モデルオプションは [runtime-dependencies.js](assets/js/runtime-dependencies.js)、モデルと辞書のversion/bytes/SHA-256は [external-assets.json](assets/data/external-assets.json) に記録します。OCR直接管理資材3件はruntimeでもdecoded bytes/SHA-256を使用・保存前に検証します。Embeddingはrevision固定を維持し、内部cacheへ侵入しません。台帳の記載とruntime検証範囲を区別し、外部CDNの常時利用可能性を保証するものではありません。

## 学習済みモデル

| モデル | 取得元・加工 | ライセンスと確認状況 |
| --- | --- | --- |
| Stanford GloVe 6B、50次元 | [公式配布案内](https://nlp.stanford.edu/projects/glove/)、公式Hugging Faceミラーの固定revision `1db2080b2d94def6e5b0386a523102f9d8849e9d`。40,146語の共通常駐辞書と359,854語の分割入力補助（計400,000語）へ、元のFloat32値を変更せずFloat32LE変換 | **学習済みベクトルはPDDL 1.0**。GloVeコードのApache-2.0とは別。出典: Jeffrey Pennington, Richard Socher, Christopher D. Manning, *GloVe: Global Vectors for Word Representation* (2014)。入力・出力のhash、選択法、次元数、語数は `kotodama-vectors.meta.json` / `kotodama-input.meta.json` に記録 |
| all-MiniLM-L6-v2 | [Sentence Transformers](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) / [Xenova ONNX変換版](https://huggingface.co/Xenova/all-MiniLM-L6-v2)、revision `751bff37182d3f1213fa05d7196b954e230abad9`、q8、WASM | モデルカードはApache-2.0。コードのライセンスとモデルのライセンスは別々に参照 |
| PP-OCRv4 detection / recognition、ppocr_keys_v1 | [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)を元にした `@gutenye/ocr-models` 1.2.2 のONNXモデル・辞書 | PaddleOCR上流はApache-2.0。gutenyeの現行READMEはモデル・辞書もApache-2.0と記載する一方、1.2.2のnpm metadataはMIT。**当該バージョンのONNX変換元・weight対応と再配布条件は要確認**。npm packageのMITだけをweightのライセンスとして断定しない |

大型モデルのバイナリはリポジトリへ追加していません。ブラウザがダウンロードするモデルは上の固定配布物です。

## 辞書と地理データ

コトダマギアは開発時に候補ゲートを前計算し、生成済み `kotodama-lexicon.json` を配布します。マギアサークルのOCR補正索引もNodeで事前生成し、語の並び・n-gram・補正順位を変えず圧縮資材へ変換します。原本ではなく同一サイトの生成物を読み、hash検証してCacheへ保存します。source commit/SHAと変更内容は `ocr-vocabulary-index.meta.json` に記録します。

| データ | 出典・ライセンス | 変更・追加確認事項 |
| --- | --- | --- |
| profanity-list / en.txt | [dsojevic/profanity-list](https://github.com/dsojevic/profanity-list)、MIT | 英字だけの単語を禁止語Setへ加工。原文MIT表示を同梱 |
| dictionary-word-list / SCOWL系一般英単語 | [nlile/dictionary-word-list](https://github.com/nlile/dictionary-word-list)、著作権・許諾表示を保持するSCOWLの条件 | 原文著作権表示を同梱。**この配布辞書のSCOWL生成バージョン・全source noticesとの対応は要確認**。SCOWL上流のfull copyrightも参考として別ファイルに保持 |
| word-freq-top5000.csv | [filiph/english_words](https://github.com/filiph/english_words)、リポジトリはMIT、Copyright (c) 2017 Filip Hracek | 元アプリと同じ正規化・重複排除・順位付け。**CSVの上流頻度コーパスについて独立した利用条件がないか要確認** |
| Human names | [FinNLP/humannames](https://github.com/FinNLP/humannames)、MIT、Copyright (c) 2017 Alex Corvi | 固有名候補を除外。**元になった各名前sourceの利用条件・provenanceは要確認** |
| Natural Earth populated places | [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)、Public Domain | 固定revisionの地名を普通語allowlistと照合し、候補除外へ加工 |
| GeoNames cities500 | [GeoNames](https://download.geonames.org/export/dump/)、CC BY 4.0 | Credit: **GeoNames**。固定revisionの [lmfmaier/cities-json](https://github.com/lmfmaier/cities-json) の写しを利用し、主名/asciinameのトークンへ加工。旧ライブZIP取得を廃止。**ミラーの変換履歴・各フィールドの出典対応は要確認** |

辞書のcommit、元ファイルのhash、加工法は `kotodama-lexicon.meta.json` と生成スクリプトに残しています。不確実な部分は上の「要確認」と区別しており、配布元の表示だけで全ての元データの権利を確認済みとは扱いません。
