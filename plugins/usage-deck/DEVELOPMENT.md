# Usage Deck 開発ガイド

利用者向けの説明は [README.md](README.md)、リポジトリ全体の決まり(プラグインの追加、リリースの流れ)は[リポジトリの開発ガイド](../../DEVELOPMENT.md)を見てください。

## よく使うコマンド

コマンドはすべて `plugins/usage-deck` で実行します。

```bash
npm install
npm run link         # 初回のみ: 開発フォルダを Stream Deck に登録(パッケージ版とは同時に入れられません)
npm run watch        # 変更のたびにビルドしてプラグインを再起動
npm run check        # 版数の一致・型チェック・ビルド・manifest 検証
npm run e2e          # ビルドして E2E テストを実行
npm run pack         # → dist/com.noxitro.usagedeck.streamDeckPlugin(ビルドと検証込み)
```

## リリース

版数は `package.json` の `version`(x.y.z)だけで管理します。manifest の `Version`(x.y.z.0)は `scripts/sync-version.mjs` が合わせます。

```bash
npm run release -- patch   # 0.1.0 → 0.1.1。manifest も更新してコミットし、タグ usage-deck-v0.1.1 を作る
git push --follow-tags
```

タグを push した後の流れは、[リポジトリの開発ガイド](../../DEVELOPMENT.md#リリース)にあります。

## 構成

| パス | 役割 |
| --- | --- |
| `src/plugin.ts` | エントリポイント。アクションの登録と1分ごとの再描画 |
| `src/actions/` | キーの表示(`claude-usage.ts`、`github-usage.ts`)と共通の押下・長押し処理(`usage-action.ts`) |
| `src/lib/claude-cli.ts` | Claude Code CLI の探索と起動(`get_usage`、予備に `claude -p /usage`) |
| `src/lib/claude-data.ts` | 使用量の応答をプラグイン内の形にまとめ直す(`limits[]`、追加利用、古さの判定) |
| `src/lib/github.ts` | GitHub の課金 API(個人 / 組織) |
| `src/lib/poller.ts` | 表示中のキーがあるときだけ取得する共有ポーラー |
| `com.noxitro.usagedeck.sdPlugin/` | manifest・翻訳(`en.json` / `ja.json`)・設定画面(`ui/`)・アイコン |
| `com.noxitro.usagedeck.sdPlugin/ui/vendor/` | 同梱した sdpi-components v4.0.1(MIT)。CDN からは読み込みません |
| `scripts/` | 版数の同期とパッケージ作成 |
| `e2e/` | E2E テスト |

## Claude の取得方法

- CLI を `claude -p --input-format stream-json --output-format stream-json --verbose` で起動し、`get_usage` の control request を送ります。モデルは呼ばないのでコストは0、応答は約2秒です。使えない版では `claude -p /usage` のテキストを読みます。
- 起動のたびに新しい一時フォルダ(`usage-deck-*`、終了後に削除)で動かします。読む設定はユーザー設定だけ(`--setting-sources user`)にし、hooks と MCP を無効にし、セッションを保存しません。
- `ANTHROPIC_API_KEY` など別の認証情報は、大文字小文字を問わず子プロセスに渡しません。`CLAUDE_CONFIG_DIR` は渡します。
- 取得は5分ごと、手動更新は最短1分間隔です。
- CLI は取得に失敗すると、最大1時間前のキャッシュを返すことがあります。応答の生成時刻(`as_of`)が15分以上前なら古いデータとして扱い、リセット時刻を過ぎた枠は「—」にします。
- モデル別の週間枠は `limits[]` の `weekly_scoped` 項目から作ります。保存したモデル名は、大文字小文字を無視した一致、次に前方一致で照合します。
- 以前あった claude.ai Cookie 方式は削除しました。セッションキーはすぐ失効するうえ、Anthropic の規約でも第三者ツールがセッショントークンを集めることは認められていないためです。残っていた設定値は起動時に消します。

## 表示言語

- プラグイン名・アクション名・ツールチップ・キー上の文字は `com.noxitro.usagedeck.sdPlugin/{en,ja}.json` にあります。コードから使う文字列は `Localization` に置き、`src/lib/i18n.ts` の `t()` で引きます。
- SDK はキーの `.` を入れ子として解釈するので、`err.auth` は `{ "err": { "auth": ... } }` と書く必要があります。
- 設定画面の文字列は `ui/i18n.js` にあります。HTML では `__MSG_キー__` と書き、キーに `.` は使えません。`data-lang="xx"` を付けたブロックは、その言語のときだけ表示されます。ブラウザで確認するときは URL に `?lang=ja` を付けます。

## E2E テスト

`npm run e2e` は、ビルド済みのプラグイン(`bin/plugin.js`)を、SDK と同じ WebSocket プロトコルで話す偽の Stream Deck(`e2e/harness.mjs`)に対して起動します。キーの表示・押下・長押し・設定変更のイベントを送り、プラグインが返す `setImage` `showAlert` `openUrl` `setSettings` などを検証します。受け取ったキー画像は `e2e/out/*.svg` に保存されます。

- **Phase A**: 起動・押下・長押し、古い設定(Cookie 方式のセッションキー)の削除、設定画面が外部スクリプトを読まないこと。GitHub は `e2e/mock-github.mjs` が API を差し替えます。
- **Phase B**: `e2e/fake-claude.mjs` が本物の CLI の代わりに `get_usage` と同じ形の応答を返し、次を確認します。
  - 成功、テキスト予備経路、未ログイン、取得不可、無応答、異常終了、CLI 未検出
  - 古いキャッシュ、追加利用の上限なし・上限到達、取得中の設定変更、旧モデル名の変換
  - 起動時の引数・作業フォルダ・環境変数
  - GitHub の組織 API、不正な組織名、権限なし、レート制限、ログに応答本文が出ないこと
- **Phase C**: Stream Deck の言語を `ja` にして、日本語表示を確認します。
- **オプトイン**(手元で確認したいときだけ。CI では使いません)
  - `E2E_REAL_CLAUDE=1`: 自動検出した本物の CLI とあなたの Claude ログインで取得します。
  - `E2E_REAL_GITHUB=1`: GitHub の本物の API を `gh` のトークンで呼びます(`user` スコープが必要)。

本物の CLI の代わりに偽物を起動させるのは、`USAGE_DECK_CLAUDE_CLI` 環境変数によるテスト専用の口です。プラグインの環境変数は Stream Deck アプリが決めるので、利用者の設定から使われることはありません。
