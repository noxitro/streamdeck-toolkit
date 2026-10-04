# Usage Deck(Stream Deck プラグイン)

Claude のプラン利用状況と GitHub の利用量を、Stream Deck のキーに表示します。

| アクション | 表示できる項目 |
| --- | --- |
| Claude 利用状況 | 5時間枠 / 週間(全モデル)/ 週間(モデル別、例: Fable)/ 追加利用クレジット。リセットまでの残り時間と、時間の経過を示す目盛り付き |
| GitHub 利用状況 | 今月の Copilot AI units / Actions 使用時間(全体・Linux・Windows・macOS)。月の上限を入れるとバーで表示 |

- キーを押すと更新、長押し(0.6秒)で Claude / GitHub の利用状況ページを開きます。
- 右上の黄色い点は、最後の更新に失敗したか、データが古いことを示します。
- 表示は Stream Deck アプリの言語に合わせて日本語か英語になります。

開発者向けの情報は [DEVELOPMENT.md](DEVELOPMENT.md) にあります。ほかのプラグインは[一覧](../../README.md)を見てください。

## 必要なもの

- Stream Deck アプリ 7.1 以上(Windows 10 以上 / macOS 12 以上)
- **Claude を表示する場合**: [Claude Code](https://code.claude.com/docs) の CLI(`claude`)がインストールされていて、claude.ai のサブスクリプション(Pro / Max など)でログイン済みであること
- **GitHub を表示する場合**: [GitHub CLI](https://cli.github.com/)(`gh`)でログイン済みで、トークンに `user` スコープがあること。または個人アクセストークン

## インストール

1. [Releases(usage-deck)](https://github.com/noxitro/stream-deck-toolkit/releases?q=usage-deck&expanded=true) から最新の `com.noxitro.usagedeck.streamDeckPlugin` をダウンロードします。
2. ダブルクリックすると Stream Deck アプリが開き、インストールされます。
3. アクション一覧の「Usage Deck」から「Claude 利用状況」「GitHub 利用状況」をキーにドラッグします。

**更新するとき**は、新しい版の `.streamDeckPlugin` を同じようにダブルクリックします。今のところ自動更新はないので、Releases を確認してください。

## 初回の設定

### Claude

1. ターミナルで `claude` を起動し、`/login` で claude.ai のアカウントにログインします(一度だけ)。
2. キーを置けば、5分ごとに自動で更新されます。設定画面で「表示項目」と、モデル別の場合は「モデル」を選びます。

プラグインは Claude のトークンを読まず、保存も送信もしません。インストール済みの CLI に使用量を問い合わせるだけで、ログインの更新も CLI が自分で行います。モデルの呼び出しは行わないので、使用量は消費しません。

`claude` が見つからないとき(キーに「CLI未検出」)だけ、設定画面の「claude のパス」に `claude.exe` のフルパスを入れてください。

### GitHub

- `gh auth login` 済みなら、設定は不要です。キーに「権限なし」と出る場合は、トークンに `user` スコープを追加します。

  ```bash
  gh auth refresh -h github.com -s user
  ```

- `gh` を使わない場合は、設定画面の「トークン」に個人アクセストークンを入れます(fine-grained トークンなら、ユーザー権限の **Plan: read** が必要)。

### 職場のアカウントで使う場合

- **GitHub Copilot**: ライセンスが組織や Enterprise で管理・課金されている場合、その利用量は個人の請求データに含まれません([GitHub の公式文書](https://docs.github.com/en/rest/billing/usage))。そのため、キーにはほとんど(または何も)表示されません。
- 組織の管理者は、設定画面の「組織名」に組織名を入れると、組織全体の利用量を表示できます。管理者以外が入れると「権限なし」になります。
- **Claude**: 職場のプラン(Team / Enterprise)で使用量が取得できるかは未確認です。

## キーの表示の意味

| 表示 | 意味と対処 |
| --- | --- |
| 要ログイン | Claude Code CLI がログアウト状態です。ターミナルで `claude` → `/login` |
| 取得不可 | ログイン済みですが、今は取得できません(オフライン・混雑など)。しばらくすると自動で再試行します |
| CLI未検出 | `claude` が見つかりません。設定画面で `claude.exe` のパスを指定してください |
| CLI応答なし / CLIエラー | CLI が応答しないか、異常終了しました |
| 未検出 | 選んだモデルの週間枠が、今のプランにはありません |
| 権限なし | GitHub の課金データを読む権限がありません(上の「GitHub」を参照) |
| 制限中 | API のレート制限中です。自動で間隔を延ばして再試行します |

## プライバシー

- GitHub のトークン(入力した場合)と組織名は、Stream Deck のローカル設定にだけ保存されます。
- ログには HTTP のステータスだけを書き、応答の本文やトークンは書きません。
- 以前の版で使っていた claude.ai のセッションキーは、この版を起動したときに設定から削除されます。

## 注意

- 使用量を返す仕組み(Claude Code の `/api/oauth/usage` と CLI の `get_usage`)は非公開・実験的な機能で、仕様が変わると動かなくなる可能性があります。
- Anthropic・GitHub・Elgato とは関係のない個人プロジェクトです。Claude・GitHub・Copilot・Stream Deck は各社の商標で、ここでは対象のサービスを示すためだけに使っています。

## ライセンス

[MIT License](../../LICENSE)。配布パッケージに含まれる第三者のソフトウェアとそのライセンスは次のとおりです。

- `bin/THIRD_PARTY_NOTICES.txt`: プラグイン本体にバンドルした npm パッケージ(@elgato/streamdeck、zod、ws など。ビルド時に自動生成)
- `ui/vendor/`: 設定画面の sdpi-components(MIT)と、その中の Lit(BSD-3-Clause)
