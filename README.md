# マギア・ファンタジー LARPツール

GitHub Pages で公開する、ブラウザー向けのファンタジー LARP ツール集です。画像から魔法陣を読み取る「マギアサークル」と、呪文を作る「コトダマギア」を収録しています。

## アプリ

- [作品一覧](index.html)
- [コトダマギア](kotodama.html)
- [マギアサークル](magia-circle.html)

## 開発

Node.js を用意して依存パッケージをインストールします。

```sh
npm ci
npm run serve
```

ローカルサーバーを起動したら、表示されたアドレスをブラウザーで開きます。公開ページはリポジトリ直下の HTML を入口にしているため、GitHub Pages のルート公開に対応しています。

## 画像バッチ確認

魔法陣画像を解析して、OCR・相・紋・威力の結果をまとめて出力します。

```sh
npm run test:image-outputs -- path/to/image.png
```

OCR 結果だけを確認する場合:

```sh
npm run test:spell-ocr -- path/to/image.png
```

初回の画像一括確認では、文章 Embedding モデルの取得にネットワーク接続が必要です。モデル ID は `Xenova/all-MiniLM-L6-v2` です。

ブラウザー表示とバッチ結果の比較手順は [画像出力の比較](docs/IMAGE-OUTPUT-COMPARISON.md) を参照してください。ライセンス情報は [LICENSE](LICENSE) と [第三者ライセンス表示](THIRD_PARTY_NOTICES.md) に記載しています。

## フォルダ構成

- `assets/js/` — ブラウザーで動作するアプリコード
- `assets/images/` — サンプル画像などの画像資材
- `tests/` — 画像バッチ処理と計算ロジックの確認コード
- `scripts/` — ローカルサーバーや結果比較などの補助スクリプト
- `docs/` — 開発・確認手順
