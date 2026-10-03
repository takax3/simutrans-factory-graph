# Simutrans Factory Graph

Simutrans Standard の `.pak` を読み込み、産業と貨物の関係を上流・下流へ辿る Windows デスクトップアプリです。Tauri 2 / Rust / React / TypeScript を使用し、アプリ内で解析・表示します。HTTPサーバは起動しません。

## 使い方

1. `Simutrans Factory Graph_0.1.0_x64-setup.exe` を実行してインストールします。ビルド後の `target/release/simutrans-factory-graph.exe` を直接起動することもできます。
2. 「フォルダを追加」またはフォルダのドロップでPakset・Addonを登録します。
3. 必要に応じてハンドルのドラッグや上下ボタンで並べ替えます。**下のフォルダほど優先**されます。
4. 「読み込みを開始」で解析し、診断があれば確認します。
5. 産業／貨物タブで日本語名または内部名を検索し、起点を選びます。
6. 起点の上側で要求貨物・生産産業（上流）、下側で生産貨物・消費産業（下流）を展開・折り畳みます。上側の枝は上流のみ、下側の枝は下流のみを辿り、起点を共有する上下2本の木として表示します。上流は操作ノードより上、下流は下に配置します。起点は赤枠と「起点」ラベルで表示します。ノード右上の「起点にする」をクリックすると、その産業・貨物を新しい起点にして上下各1段から表示し直します。初期表示では起点の上下の直下関係を開きます。

キャンバスをドラッグして移動、ホイールまたは左下のボタンで拡大・縮小できます。「起点へ戻る」は現在の起点を中央に戻します。左下の全体表示ボタンは表示中のノードを画面内に収めます。

- 同じオブジェクトの再登場は「共有」と表示します。枝ごとに独立して展開できます。
- 祖先と同じオブジェクトに戻る場合は「循環参照」と表示し、それ以上展開しません。
- 表示上限は1,000ノードです。上限を超える展開は行わず、別の枝の折り畳みを案内します。
- 読み込みに失敗しても、直前の利用可能な解析結果は保持します。読み込み元を変更したときは再読み込みしてください。

PAKや翻訳ファイルは変更しません。起動中の状態はメモリに保持し、終了時に破棄します。

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
- インストーラ：`target/release/bundle/nsis/Simutrans Factory Graph_0.1.0_x64-setup.exe`

インストーラは現在のユーザー向けです。WebView2未導入の環境では、インストール時にMicrosoftのランタイム取得が必要です。アプリ自身にはネットワーク機能はありません。

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

実PAKは同梱していません。固定版と取得先は [PAK互換性](docs/compatibility.md) に記載しています。

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

GitHub ActionsはWindows上でRust／UIテストとインストーラのビルドを実行します。第三者PAKのダウンロードはCIに含めません。

## 構成と制限

- `crates/pak-core`：PAK解析・翻訳・Registry・Graph。Tauriへの依存なし。
- `crates/pak-cli`：JSON出力用CLI。
- `src-tauri`：バックグラウンド読み込みとIPC、Windows配布設定。
- `ui`：読み込み元設定・起点選択・グラフ表示。

[設計とデータ契約](docs/architecture.md) / [PAK互換性と検証結果](docs/compatibility.md)

初期版はStandard向けです。Extended、年代・生産量・立地条件、画像抽出、保存プロファイル、画像出力、グラフ上からの直接起点変更は対象外です。同一ソース内の重複採用順は本ツールのルールであり、Simutrans本体のファイル列挙順との一致は保証しません。

Simutrans本体とは独立した補助ツールです。第三者Paksetや公式ソースは配布物に含めていません。

