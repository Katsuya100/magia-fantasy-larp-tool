# Google Drive 自動バックアップのセットアップ

> **PR段階 / 本番未設定**：OAuthクライアントIDは空のため、公開ゲームではこの機能は無効です。Cloud側の設定を行い、iPhone Safariなどで実機認証を確認してから有効化してください。

## 目的

マギアサークル・ダンジョンアタックのプロフィール、現在の探索状態、アイテム、魔法陣の元画像（Blob）をGoogle Driveの非表示アプリデータ領域 `appDataFolder` に自動バックアップする。既存のIndexedDB `magia-dungeon-v1` のローカルセーブを変更せず、追加の保護層とする。プレイヤーごとに自分のGoogle Driveに保存される。Googleパスワードはゲームで扱わない。

## 有効化手順（リポジトリ管理者）

1. Google Cloud Consoleでプロジェクトを作成し、**Google Drive API**を有効化する。
2. Google Auth PlatformでOAuth同意画面を設定し、必要ならテストユーザーを追加。公開対象のユーザーへ拡大するにはアプリの公開設定・Googleによる検証要件も確認する。
3. OAuthクライアントの種類 **ウェブ アプリケーション** を作り、**承認済みのJavaScript生成元**に `https://katsuya100.github.io` を登録する（`/magia-fantasy-larp-tool` のパスは含めない）。開発用ローカルホストは必要に応じて別途登録する。
4. 発行された **クライアントIDだけ**を `assets/js/dungeon-google-config.mjs` の `GOOGLE_CLIENT_ID` に設定する。これは公開される識別子で、秘密ではない。**クライアントシークレット、アクセストークン、更新トークンは絶対に設定・コミットしない**。
5. PRをレビューし、GitHub Actions `npm test`, `npm run check`, `npm run build` が通ることを確認する。iPhone Safari / ホーム画面Webアプリ / PCブラウザで認証、バックアップ、復元、競合表示の実機検証を行う。
6. 本番でOAuth同意画面にプライバシーポリシーなどの情報を求められる場合はGoogleの要件に従う。

## 動作

- 「Google Driveに接続して自動同期」は初回のアカウント権限付与**だけ**の操作。その後は、接続中にIndexedDBにセーブされると変更を検出して約1.8秒後に自動アップロードする。画面に戻ったとき・オンライン復帰時にも再試行する。
- Driveへのアクセス権は `https://www.googleapis.com/auth/drive.appdata` に限定。ゲーム独自のサーバーやログにはトークンを送らない。トークンはJSのメモリのみ保持する。
- Cloudには `magia-dungeon-save-v1.json` を保存。画像はbase64で内包する（容量上限あり）。大きい写真を含む場合も扱えるようDriveのresumable uploadを使う。
- 起動済みのゲームが再接続し、クラウドにデータがある一方、端末が初期状態なら自動復元してページを再読み込みする。リモートだけ更新され、端末は前回同期から変更なしの場合も復元する。
- **競合時は自動で上書きしない**。両方異なるセーブの場合、Driveのデータもローカルのデータも保持し、状態を画面表示する。復元・競合解消の手動UIは未実装。
- 端末側で「冒険データをすべて削除」した場合、自動復元を抑止するマーカーを残す。**Google Drive側のバックアップは削除しない**。削除ボタンの意味・Drive側データ削除のUIは正式リリースまでに整理する。

## 必ず把握する制限（継続開発）

- **現在の構成は「完全放置の永久自動同期」ではない。** Google Identity Servicesのブラウザ向けトークン方式では、認証・再認証にユーザー操作が必要な場合がある。Safariで期限切れ後やページを再度開いた際に無操作でトークン再発行する保証はない。Webページを閉じている間はJavaScriptが動作せず、バックアップも走らない。バックグラウンド移行直前の未送信の変更も保証できない。
- 要件の「一度つないだら常に自動（再認証まで含む）」を保証するには、認証コード方式、サーバー側で安全に保持するリフレッシュトークン、適切なバックエンドや定期同期、トークンの失効・取り消し処理を持つ別構成の検討が必要。**公開のGitHub Pages JSにリフレッシュトークンやクライアントシークレットを置くのは厳禁。**
- Google Drive APIの更新には完全な原子的競合防止機構がないため、複数端末から同時に書き込む場合に競合や最終書き込み競争が起こり得る。今はアップロード直前の更新時刻チェックと保守的な同期停止で被害を減らす設計。マルチ端末の同時編集に対応するにはサーバー側の楽観的ロックや履歴世代管理などが必要。
- Google DriveのappDataFolderはDriveのマイファイルには表示されない。Google側でアプリへのアクセスを削除したり、ユーザーがアプリデータを削除すると復元できない。
- トークンの期限切れ・Drive API障害・端末オフライン・権限取り消し・容量不足などでは自動同期を保証しない。端末側のIndexedDBには保存を継続する。
- OAuthでGoogleが提示する画面と、アプリ側で表示する状態を両方確認する。未認証・同期失敗のとき「バックアップ済み」と表示してはならない。

## 参照資料

- Google Identity Services token model: https://developers.google.com/identity/oauth2/web/guides/use-token-model
- Google Drive appDataFolder: https://developers.google.com/workspace/drive/api/guides/appdata
- Google Drive resumable uploads: https://developers.google.com/workspace/drive/api/guides/manage-uploads
