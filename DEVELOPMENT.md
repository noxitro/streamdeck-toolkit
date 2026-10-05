# 開発ガイド(リポジトリ全体)

プラグインごとの詳しい仕組みは、各プラグインの `DEVELOPMENT.md` にあります(例: [Usage Deck](plugins/usage-deck/DEVELOPMENT.md))。

## 決まりごと

- **プラグインは `plugins/<名前>/` に、ほかと独立して置く。** 自分の `package.json`・`package-lock.json`・`node_modules` を持ち、ほかのプラグインに依存しない。
- **名前**: フォルダ名(`usage-deck` など)が Release のタグの接頭辞になる。プラグインの UUID は `com.noxitro.<名前から記号を除いたもの>`。
- **各プラグインに必要な npm スクリプト**(CI と Release が呼ぶ)
  - `check`: 版数の一致・型チェック・ビルド・manifest の検証
  - `pack`: ビルドと検証をして `dist/*.streamDeckPlugin` を作る
  - `e2e`(任意): E2E テスト。外部のアカウントや秘密情報なしで通ること
  - `release`: 版数を上げ、manifest を合わせてコミットし、タグ `<名前>-vX.Y.Z` を作る(`scripts/release.mjs`)
- **版数**は `package.json` の `version` だけで管理し、manifest の `Version` はスクリプトで合わせる。
- **`.npmrc` は置かない**。トークンを書く場所なので、公開前のチェック(pre-commit hook)が認証情報ファイルとして止める。タグの接頭辞は `release` スクリプトが付ける。
- **配布物に第三者のコードを入れたら、そのライセンス表記も配布物に入れる**。バンドルした npm パッケージは、ビルド時に `bin/THIRD_PARTY_NOTICES.txt` を生成する(Usage Deck の `rollup.config.mjs` を参照)。手で同梱したファイルはライセンス文を隣に置き、`.githooks-allow` にパスを書く。
- **説明書は日本語**。利用者向けの `README.md` と開発者向けの `DEVELOPMENT.md` を分け、ルートの README のプラグイン一覧に1行足す。

## プラグインを追加する

1. `plugins/usage-deck/` を参考に、`plugins/<名前>/` を作る(Elgato の `npx @elgato/cli create` で作ったものを移してもよい)。
2. 上の「決まりごと」の npm スクリプトを用意する(`scripts/` は Usage Deck のものを流用できる)。
3. ルートの `README.md` のプラグイン一覧に行を足す。
4. push すると CI がそのプラグインも自動で検査する(`plugins/*` を全部拾う)。

## リリース

```bash
cd plugins/<名前>
npm run release -- patch   # 版数を上げて manifest も合わせ、コミットとタグ <名前>-vX.Y.Z を作る
git push --follow-tags
```

タグを push すると `.github/workflows/release.yml` が次を順に実行します。

1. タグからプラグインを特定し、`package.json` の版数と一致するか確かめる
2. `npm run check`、`npm run e2e`、`npm run pack`
3. GitHub Release を作り、`.streamDeckPlugin` を添付する

`main` への push と pull request では、`.github/workflows/ci.yml` が全プラグインの `check` と `e2e` を Linux・Windows・macOS の3つで実行します(公開リポジトリでは標準ランナーが無料のため)。Release は Linux だけで作ります(パッケージ作成は OS に依存しないため)。
