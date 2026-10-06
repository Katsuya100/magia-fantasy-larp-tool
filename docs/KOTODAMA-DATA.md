# コトダマギア：自由入力と候補の分離、配布・計測

## 旧仕様と復元

旧commit `89e80a197281c7a08f79ae1a03dcf5dd209c52e6` の `parseSpell → vecFromTerms` は、GloVeにある語を使い、禁止語だけを内容上の理由で拒否していました。人名・地名・canonical・frequencyは入力判定へ入りません。これらは近似解・偶然の墨・欠片等の候補出力だけを絞る規則でした。

前回の40,146語pruneは、そのベクトルstoreだけで入力可否を決めたため、この役割分離を失わせていました。今回、候補計算用の軽量資材を全て保持したまま、自由入力用の補助を復元しています。

| レイヤー | 語数と役割 |
| --- | --- |
| 入力GloVe | 元の先頭400,000語。人名・地名・frequencyでpruneしない |
| 旧構文で一語として直接表せる入力 | 327,245語。従来の `[a-z0-9_]+` / `+` / `-` 構文は変更しない |
| GloVeにある禁止語 | 195語（禁止リスト全体は463語）。上記一語表記から拒否すると327,050語を直接使用可能 |
| 常駐ベクトル | 前回の40,146語・50次元。入力の一部と属性・候補計算を高速に扱う |
| 補助入力ベクトル | 残り359,854語を64区画へ分割、計71,970,800 bytes |
| 候補出力 | 従前の全gateを通った2,516語。入力storeの存在だけで候補可にしない |

`isInputWord` はGloVeへの存在確認、`isForbiddenWord` は禁止語確認、`isCandidateWord` は前計算候補への存在確認です。実際の入力許可は、従前の文法に従うこと、GloVeにあること、禁止語でないことの組合せです。禁止語でもGloVe自体の搭載membershipはtrueで、`parseSpell` が明示拒否します。

## 候補gateとallowlist

`looksLikePlainEnglishWord`、canonical、frequency上限5,000、禁止語、人名・地名除外、元のNAME/PLACE allowlistを維持します。ランダム語のfrequency上限3,000、候補の並び、ランキング演算も維持しています。政治・国家・身分・ファンタジー語等を整理・縮小していません。

allowlistはその人名/地名gateの免除であり、全gateの強制免除ではありません。固定辞書では `turkey / orange / reading / mobile / nice` はPLACE allowlistにありますが、NAME allowlistにはなく、人名gateで候補外です。いずれも入力可能です。`river / storm / king / queen / empire / state` は候補にも残ります。これを偽って候補可とせず、旧定義全件fixture、他のgateを通る合成fixtureでの例外復活、実辞書の分類fixtureを検証します。

## 配布案の比較

| 案 | 通信・メモリ・複雑さ | 判断 |
| --- | --- | --- |
| A: 全Float32+index | 単純・全取得後offline可能だが、初回数値80MBと索引を取得し、数値全体が常駐する | 通常起動には採用しない |
| B: 分割補助 | 既存8.03MB数値と全入力indexを先に読み、必要区画だけ通常fetch/Cache API。区画を順次扱い、使用語50次元だけ保持 | **採用**。64個の標準Float32LE、JSON index、metadataという形式 |
| C: Range | vector1語だけ取得できるが、Pages/CDNのRange・partial cache・offline等を追加管理する | ブラウザには採用しない |

入力indexは3,743,494 bytesで、全補助語からbucketとrowへ整数Mapを作ります。359,854個の `[bucket,row]` 配列を作らず、一つの整数locationにしています。入力時は必要bucketだけ順次取得し、各vector200 bytesをコピーします。bucket全体をsubarrayの参照で保持せず、現在の術式に必要な語だけ保持します。入力語が多い場合、その術式の使用語分のメモリは必要です。

普通の初期術式は追加区画を取りません。rare語は約1.1MBの区画を追加します。使用済み区画はCacheへ保存し、別の術式を挟んだ後やofflineでも再利用できます。未取得の既知語をofflineで使ったときは、語が存在しないと偽らず通信／写本不足を表示します。キャッシュの削除・保存が制限されたときでも、onlineなら進められます。

全区画は自動で一括取得しません。Service WorkerによるHTML/JSを含むサイト全体のoffline配信もありません。全40万語をofflineで使うには、それぞれの必要区画の控えが必要です。

## 数値比較

2026-10-06、MBは10^6 bytes。未圧縮ファイルpayloadです。HTTP overhead・圧縮配信・browser storage管理領域は含みません。

| 項目 | 前回40,146語版 | 自由入力復元後 |
| --- | ---: | ---: |
| 初回payload | 8,551,008 | 12,307,658 |
| warm起動で更新確認するmetadata payload | 5,734 | 18,890 |
| Cache body payload（初回） | 8,550,354 | 12,305,087 |
| 常駐数値配列 | 8,029,200 | 8,029,200 |
| 補助区画1個 | なし | 1,103,000～1,150,000 |
| 全補助を取得した総payload | 該当なし | 84,278,458 |
| 全補助のCache body概算 | 該当なし | 84,275,887 |
| 本来の全数値データ | 8,029,200 | 計80,000,000（全量常駐しない） |

`quasar` と `anemometer` の2語を初めて用意した例では追加2,249,600 bytes、Cache合計14,554,687 bytes、保持する追加vectorは400 bytesでした。warm再利用では追加payload0です。旧862,182,753-byte ZIPはブラウザへ取得させません。

### Node参考値

`npm run benchmark:kotodama` は別processのNode 24.21.0/Windowsで前回候補用loaderと新入力用loaderを測ります。ローカルファイルfetch、Cache payload counter、GC snapshotと10ms memory samplingです。

| 一回の記録 | 前回版cold | 復元後cold | 前回版warm | 復元後warm |
| --- | ---: | ---: | ---: | ---: |
| 初期化ms | 125.40 | 295.96 | 61.16 | 225.86 |
| 完了後heapUsed bytes | 11,399,200 | 35,673,528 | 11,473,048 | 35,785,840 |
| 完了後process RSS bytes | 87,240,704 | 135,254,016 | 95,768,576 | 170,573,824 |

入力索引のMap/文字列等の分、heapは増加します。常駐数値80MBには戻していません。Node RSSはruntime・一時buffer・GC・以前のroundのheap確保等を含み、定常dictionaryメモリそのものではありません。network時間、実browser Cache Storage overhead、スマートフォン実測ではありません。観測peakは瞬間的な最大値を逃す可能性があります。全snapshotは `test-results/input-restoration/kotodama-comparison.json` に記録します。

## 再現と形式

```sh
npm run build:kotodama-vectors -- --download
npm run build:kotodama-lexicon -- --download
npm run build:kotodama-input-vectors
npm test
```

固定公式HF ZIPから開発用Nodeだけが50d entryをHTTP Rangeで取得し、source SHAを検証します。ブラウザのRange依存はありません。171MB原本・ZIPは `.tmp/` に置き、Gitへ追加しません。生成物はf32、JSON、metadataです。既存の軽量40146/lexicon2516のファイルbytesは変更しません。

入力metadataにはsource revision/SHA、dim、全語・補助語・構文readable語数、全区画とindexのbyte数/SHA、共通常駐words SHA、生成方法を記録します。Float32LE値は元テキストの全20,000,000要素と一致します。全66ファイルの再生成がbyte-for-byte一致することを確認しました。LF/binary属性でGitの改行変換を防ぎます。

## テストと境界

- 旧14術式goldenを維持、新8術式は元HTML git blobを検証してから元GloVe値・元cast/cosine/attrScores/manifestで独立生成。
- `anemometer / quasar / astrolabe / chiaroscuro / syzygy` のcandidate不可・input可と実計算。
- 禁止語は明示拒否、人名 `usain / john` と地名 `london` は入力可・候補不可。
- 元NAME/PLACE allowlist全件、合成fixtureの例外復活、実固定辞書の分類。
- 初回に補助f32を取らない、必要bucketだけ取得、warm/offline再利用、未cache語の通信不足、手動refresh後のcache利用、200-byte rowだけ保持、失敗時に前術式を保つ。
- SHA/サイズ、50dim、非有限値、重複、source改変、byte再現、全配布f32の検証。

マギアサークルの共有威力・相の計算式、画像処理定数、OCR精度定数、Workerの処理順は変更しません。入力復元は候補gate変更と分けています。実機項目は [MOBILE-TEST-CHECKLIST.md](MOBILE-TEST-CHECKLIST.md)、OCR索引は [OCR-VOCABULARY-INDEX.md](OCR-VOCABULARY-INDEX.md) を参照してください。
