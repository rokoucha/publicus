# Publicus

個人用のファイル共有ツール。1つの Cloudflare Worker と非公開 R2 バケットを使います。

| パス | 用途 |
| --- | --- |
| `/admin/` | 管理画面。アップロード、一覧、削除 |
| `POST /api/files` | 自動化用のアップロード API |
| `/mcp` | リモート MCP。Streamable HTTP、OAuth、`publish` ツール |
| `/s/<id>` | URL を知っている人が開ける共有ページ |

Markdown は HTML に変換します。HTML はスクリプトを実行できるサンドボックスで開きます。インライン CSS・JS と HTTPS の画像を使えます。安全にインライン配信できる形式を除き、ファイルはダウンロードされます。共有 URL はファイルを削除すると無効になります。

管理画面と API の上限は 20 MiB、MCP はデコード後 2 MiB、Markdown は入口を問わず 1 MiB です。MCP ではファイル名と `text` または `base64` のどちらかを渡します。

## CLI

Node.js 22.15 以降で、プロジェクトディレクトリから `npm install -g .` を実行します。Cloudflare Access のサービストークンを `PUBLICUS_CLIENT_ID` と `PUBLICUS_CLIENT_SECRET` の環境変数から読み取ります。

```sh
publicus screenshot.png
pbpaste | publicus --name notes.md | pbcopy
git diff | publicus --name changes.diff
```

成功時は共有 URL だけを標準出力に書きます。名前を省略した標準入力は `stdin.txt` として投稿します。API を直接呼ぶ場合はファイル本体をリクエスト本文にし、`X-File-Name` にパーセントエンコードしたファイル名を指定します。

## CI とデプロイ

GitHub Actions はプルリクエストと `main` で `npm ci`、テスト、Worker のドライランを実行します。

本番デプロイには Cloudflare Workers Builds を使います。既存の `publicus` Worker の **Settings → Builds → Connect** から GitHub の `rokoucha/publicus` に接続し、次のように設定します。

| 設定 | 値 |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` |
| Build command | 空欄 |
| Deploy command | `npm run deploy` |
| Preview builds | オフ |
| Build environment variable | `NODE_VERSION=24` |

`main` への push で本番デプロイが始まります。GitHub Actions の CI は独立して実行されます。

Renovate は npm 依存関係と GitHub Actions の更新を PR にします。ロックファイルのメンテナンスは週次です。利用するには Renovate をリポジトリに有効化します。

### Cloudflare の初回設定

Worker の独自ドメインと非公開 R2 バケットは [Wrangler 設定](wrangler.jsonc) に記載しています。Zero Trust には次の3つの self-hosted Access アプリケーションを設定します。

| アプリケーションのドメイン | 設定 |
| --- | --- |
| `p.rokoucha.net/admin` | 管理画面と管理 API。Allow ポリシーで所有者のメールアドレスだけを許可 |
| `p.rokoucha.net/api/files` | CLI。Service Auth ポリシーで専用サービストークンを許可 |
| `p.rokoucha.net/mcp` | リモート MCP。所有者だけを許可し、Managed OAuth と Dynamic Client Registration を有効化 |

共有パスの `/s/` は匿名公開です。Worker の `ACCESS_ISSUER` に Access のチーム URL、`ADMIN_AUDIENCE`、`API_AUDIENCE`、`MCP_AUDIENCE` に各アプリの Audience Tag を設定します。

ChatGPT から接続する場合は `https://p.rokoucha.net/mcp` を指定し、OAuth の登録方法は DCR を選びます。Access のリダイレクト許可リストには `https://chatgpt.com/connector/oauth/*` を追加します。
