# ダンジョンアタック：テスト一覧

このドキュメントは「何を実際にテストしたか」を明確にするための一覧。テストは `npm test` 経由で GitHub Actions CI（`.github/workflows/ci.yml`）に含まれる。

| 機能 | テスト | 確認事項 |
|---|---|---|
| 起動・CSV読込 | `test-dungeon-ui`, `test-dungeon-core` | 画面初期化、CSV読込、プレイヤー作成 |
| IndexedDB接続・初期化 | `test-dungeon-store`, `test-dungeon-ui` | 接続・スキーマ生成・再接続、接続失敗、blocked、接続オブジェクト未取得 |
| 魔法陣ライブラリ | `test-dungeon-store`, `test-dungeon-ui` | カメラ登録、写真Blob保存、5枚編成、性能判明前の非公開、登録内容永続化 |
| 魔法陣初回使用時の解析 | `test-dungeon-ui` | 既存画面への画像引き渡しを模擬、結果反映、失敗時の非消費・再試行 |
| 攻撃・防御・回復・弱体 | `test-dungeon-core`, `test-dungeon-effects` | 全7属性×4紋、属性耐性、補正とDEF、回復上限、同属性弱体解除 |
| 属性固有の弱体 | `test-dungeon-effects` | 火傷、感電、浸水、目眩、重圧、封印、混乱 |
| プレイヤー/敵の共通ルール | `test-dungeon-core`, `test-dungeon-effects` | 同値ステータスなら同ダメージ/同MP消費、同ターン解決 |
| 敵マスター・ボス | `test-dungeon-core`, `test-dungeon-effects`, `test-dungeon-ui` | 敵データ整合、レベル成長、階層別敵レベル、5戦ボス |
| レベルアップ・キャリー枠 | `test-dungeon-core`, `test-dungeon-effects` | Lv.1〜99、経験値、上限3→15、CSV調整反映 |
| アイテムドロップ | `test-dungeon-core`, `test-dungeon-effects`, `test-dungeon-ui` | 1〜7個、種類別抽選、回復量の最小最大、追加バフ |
| アイテム使用 | `test-dungeon-core`, `test-dungeon-effects`, `test-dungeon-ui` | HP/MP回復、7属性浄化、追加耐性バフ、ターン消費なし、ラウンド上限 |
| 連戦・HP/MP持ち越し | `test-dungeon-ui` | 第1〜5戦、再アタック、第6戦への続行 |
| 帰還・敗北 | `test-dungeon-ui` | 5戦ごとの帰還、経験値/物資確定、再アタック、敗北時未確定分破棄 |
| 再読込からの再開 | `test-dungeon-store`, `test-dungeon-ui` | 保存した探索・アイテム・既知魔法陣を再読み込み |
| カメラ許可拒否 | `test-dungeon-ui` | 撮影不可時のエラー表示 |
| 名前入力ダイアログ | `test-dungeon-ui`, `test-dungeon-presentation` | 初回の必須入力、空白拒否、変更、永続保存と再読込時の非表示 |
| 収集図鑑 | `test-dungeon-ui`, `test-dungeon-presentation` | 独立タブ、12枠マトリクス、未発見の？？？、入手時の開示、敗北後の保持 |
| 世界観・作図規則 | `test-dungeon-presentation` | キャッチコピー、カメラ限定、紋の説明、共鳴率表記なし、既存サンプルPNG、スマホ幅レイアウト |
| 準備画面の5列グリッド | `test-dungeon-loadout`, `test-dungeon-ui`, `test-dungeon-presentation` | 魔法陣5枠とアイテム5列、位置保持・重複防止・スワップ、レベル上昇による追加行と既存セーブ移行 |
| 編成選択ダイアログ | `test-dungeon-loadout`, `test-dungeon-ui` | 各枠から開き、魔法陣一覧・アイテム一覧から指定枠へ編成 |
| カメラ連続撮影 | `test-dungeon-ui` | カメラを閉じず5枚連続登録・通知の非表示・1つのストリーム再利用・閉じるときだけ停止 |
| プロフィール紋章の位置 | `test-dungeon-presentation` | 紋章と円形装飾の中心固定、スマートフォンの表示サイズ |
| 属性表示 | `test-dungeon-presentation` | 7属性すべての絵文字付き作図規則表記 |
| 表示・ビルド | `npm run check`, `npm run build` | JavaScript構文とページの静的ビルド |

## テストの信頼範囲

`test-dungeon-ui` は **ブラウザの画面操作を模擬する統合テスト**。カメラ・IndexedDB・既存解析画面の最終結果をテスト用の実装に置き換え、UIとゲーム内のデータ受け渡し・保存の動作を検証する。**実機のカメラ起動、スマートフォン固有のファイル入力仕様、OCR/Embeddingモデルの実推論までは保証しない。** 既存のマギアサークル本体には一切変更を加えていない。画像解析自身の単体テスト・定期E2Eは既存の検証手順を利用する。

実機確認では、Safari/Chromeで撮影を5回行い、最初の1枚を戦闘で使って属性・紋・威力が保存されること、ページ更新後に既知のままであることを確認する。これは通常CIの合格とは別の受け入れ確認項目。

## 起動不具合の再発防止

`dungeon-app.mjs` の初期化時に `allCircles()` へDBを渡さず `db.transaction` が失敗する不具合を修正した。画面の最初のロードから5枚登録する統合テストが、同種の呼び出し漏れを捕まえる。

`dungeon-store.mjs` は有効なIndexedDB接続かを確認し、保存トランザクションの完了を待つ。接続が取れないケースでも意味のある日本語エラーを出す。

| 条件付きタブ・戦闘グリッド | `test-dungeon-presentation`, `test-dungeon-ui` | 冒険前の4タブ・冒険中のみ3タブ、準備画面から魔導書への二重遷移を削除。戦闘中の魔法陣5枚の画像、アイテム5列・空枠、帰還・敗北で4タブに復帰 |
