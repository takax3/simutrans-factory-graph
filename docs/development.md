# 開発者向けガイド

[利用者向けREADME](../README.md)

Tauri 2 / Rust / React / TypeScriptで構成するWindowsデスクトップアプリです。アプリ内でPAKを解析・表示し、HTTPサーバは起動しません。以下のコマンドはすべてリポジトリのルートで実行します。

## 開発・ビルド

必要環境：Windows x64、Node.js 24、Rust stable (MSVC)、Visual Studio C++ Build Tools / Windows SDK、WebView2 Runtime。

```powershell
npm ci
npm run desktop
```

`desktop` は静的UIをビルドしてTauriを起動します。開発時もHTTPサーバは使用しません。UIを変更したら再実行してください。

```powershell
npm run desktop:build
```

成果物：

- 実行ファイル：`target/release/simutrans-factory-graph.exe`

スタンドアロン版の実行ファイルのみを配布します。UIは実行ファイルに埋め込まれているため、`dist` フォルダの同梱は不要です。インストーラは生成しません。

実行先には WebView2 Runtime が必要です。未導入の場合は [Microsoft の配布ページ](https://developer.microsoft.com/microsoft-edge/webview2/) から Evergreen Runtime をインストールしてください。アプリ自身にはネットワーク機能はありません。

この作業環境ではRustを `.tools/cargo` / `.tools/rustup` に配置しています。`scripts/desktop.ps1` と `scripts/cargo.ps1` はローカルツールチェーンを優先します。それがない環境ではPATH上のRustを使用します。

## CLI

GUI非依存の同じ解析ライブラリからJSONを出力します。

```powershell
cargo run -p pak-cli -- 'C:\Simutrans\pak128.japan' 'C:\MyAddon' > graph.json
```

この作業環境のローカルRustを利用する場合：

```powershell
# PowerShellスクリプトへの引数では '--' を引用符で囲んで保持する
./scripts/cargo.ps1 run -p pak-cli '--' 'C:\Simutrans\pak128.japan' > graph.json
```

JSONには `data`（産業・貨物辞書）、`diagnostics`、ファイル件数、`incomplete` を含みます。終了コードは利用可能なデータがあれば0、空なら1、引数／出力エラーなら2です。部分的な失敗は `incomplete` と診断で確認してください。

## テスト

```powershell
./scripts/cargo.ps1 test -p pak-core
./scripts/cargo.ps1 clippy -p pak-core -p pak-cli '--' -D warnings
npm test
npm run build
```

実PAKは同梱していません。検証には [pak128.Japan 120.0](http://pak128.jpn.org/souko/pak128.japan.120.0.cab)、[pak64 124.3](https://sourceforge.net/projects/simutrans/files/pak64/124-3/simupak64-124-3.zip/)、[Japan 112.0ソース](http://pak128.jpn.org/souko/sources.pak128.japan.112.0.cab) を使用します。Japanのソースは120.0と同版ではなく、代表8産業の入出力照合に使用します。

```powershell
./scripts/cargo.ps1 build -p pak-cli
node scripts/verify-paksets.mjs '<pak128.Japan 120.0フォルダ>' '<pak64 124.3フォルダ>' '<Japan 112.0ソースフォルダ>'
```

最後のソースフォルダを指定すると、公開DATの代表8産業との照合も実行します。

Windowsの実WebView2上で確認するには、先に `npm run desktop:build` を実行し、次を実行します。

```powershell
node scripts/native-smoke.mjs '<pak128.Japan 120.0フォルダ>'
```

このテストだけ一時的にWebView2のローカルデバッグ接続を有効にし、終了時にアプリを閉じます。Tauriのドロップイベントを送信してフォルダを渡し、PAK解析やRust IPCは実物を使用します。OSのフォルダ選択ダイアログ・Explorerからのドラッグ操作そのものは自動化していません。スクリーンショットは `test-results/native` に保存されます。

GitHub ActionsはWindows上でRust／UIテストとスタンドアロン版のビルドを実行します。第三者PAKのダウンロードはCIに含めません。

## Releaseの下書き作成

`v`で始まるタグをpushすると、GitHub Actionsがテスト・Windowsビルドを実行し、`simutrans-factory-graph.exe` を添付した下書きReleaseを作成します。自動公開は行いません。追加のトークン設定は不要で、Releaseを扱うジョブだけに `contents: write` を付与しています。

1. `package.json`、`src-tauri/tauri.conf.json`、ルートの `Cargo.toml` のバージョンを揃え、依存ロックファイルも更新してコミットします。タグから先頭の `v` を除いた値と3ファイルのバージョンが一致しなければビルドは失敗します。
2. 設定を含むコミットをpushしてから、そのコミットにタグを作成・pushします。例えばバージョンを `0.1.1` に更新した場合：

   ```powershell
   git push origin main
   git tag v0.1.1
   git push origin v0.1.1
   ```

3. Actionsの「Windows checks」が成功したら、Releasesで下書きを開き、変更内容・添付exeを確認して「Publish release」を押します。

同じタグのワークフローを再実行すると、既存の下書きの説明を保持してexeを差し替えます。同じタグのReleaseが公開済みの場合はエラーで停止します。既存タグに対する設定追加だけでは自動実行されないため、次のリリースはこの設定を含む新しいタグで作成してください。

## プロジェクト構成

- `crates/pak-core`：PAK解析・翻訳・Registry・Graph。Tauriへの依存なし。
- `crates/pak-cli`：JSON出力用CLI。
- `src-tauri`：バックグラウンド読み込みとIPC、Windows配布設定。
- `ui`：読み込み元設定・起点選択・グラフ表示。

[設計とデータ契約](architecture.md)

## PAK形式の互換性

画像読み込みはStandardのBUIL v0～v12、TILE v0～v2、IMG v0～v3に対応します。旧形式の寸法・画像位置・プレイヤー色の差を読み分けます。形式ごとの合成テストで検証していますが、全過去Makeobjリリースの実生成物を網羅した保証ではありません。

FACT／GOODの未知バージョンやExtended形式は、そのPAKをエラーとして除外します。同一ソース内の重複採用順は本ツールのルールであり、Simutrans本体のファイル列挙順との一致は保証しません。

[Makeobj互換性と検証状況](makeobj-compatibility-audit.md)
