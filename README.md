# streamdeck-toolkit

noxitro が作っている [Elgato Stream Deck](https://www.elgato.com/stream-deck) 用プラグインの置き場です。個人用・職場用を問わず、必要になったものをここに追加していきます。

## プラグイン一覧

| プラグイン | できること | ダウンロード | 説明書 |
| --- | --- | --- | --- |
| Usage Deck | Claude のプラン利用状況(5時間枠・週間・モデル別・追加利用)と、GitHub の Copilot / Actions の利用量をキーに表示 | [Releases](https://github.com/noxitro/streamdeck-toolkit/releases?q=usage-deck&expanded=true) | [README](plugins/usage-deck/README.md) |

## インストールのしかた(共通)

1. 上の表の「ダウンロード」から、使いたいプラグインの最新の `.streamDeckPlugin` を取ってきます。
2. ダブルクリックすると Stream Deck アプリが開き、インストールされます。
3. 新しい版が出たら、同じようにダブルクリックすると上書きで更新されます(自動更新はありません)。

必要なものや初回の設定は、プラグインごとの説明書を見てください。

## リポジトリの構成

```
plugins/<プラグイン名>/   プラグインごとに独立(ソース・テスト・説明書・package.json)
.github/workflows/        CI(全プラグインを検査)と Release(タグごとに配布ファイルを公開)
DEVELOPMENT.md            プラグインの追加とリリースの流れ
```

## ライセンス

[MIT License](LICENSE)。各プラグインの配布パッケージには、同梱した第三者のソフトウェアのライセンスも入っています(詳しくは各プラグインの説明書)。

Anthropic・GitHub・Elgato とは関係のない個人プロジェクトです。各社の製品名・サービス名は、対象を示すためだけに使っています。
