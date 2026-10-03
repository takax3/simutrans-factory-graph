# 設計とデータ契約

## 依存関係

```text
PAK / text/*.tab
        ↓
pak-core: parser → registry + translations → graph
        ↓                               ↓
     pak-cli                      Tauri command / Channel
                                        ↓
                              React → React Flow / Dagre
```

Rust coreはUI・Tauriに依存しないCargoライブラリです。Registryで採用定義を確定した後にGraphを構築するため、上書きされた古い入出力がグラフに残りません。

## Rust API

```rust
normalize_sources(paths: &[PathBuf]) -> Result<Vec<PathBuf>, String>
load_sources(paths: &[PathBuf]) -> LoadReport<PakRegistry>
load_sources_with_progress(paths: &[PathBuf], progress: impl FnMut(Progress))
    -> LoadReport<PakRegistry>
build_graph(registry: &PakRegistry) -> IndustryGraph
graph_report(report: LoadReport<PakRegistry>) -> LoadReport<IndustryGraph>
```

- `SourceRef`：ディレクトリ、ファイル、ファイル内オブジェクト位置。
- `Object`：`id`、`kind`、内部名・表示名、形式バージョン、入力・出力、採用元、上書き履歴。
- `IndustryGraph`：`industries` / `goods` のID辞書。各産業に入力・出力、各貨物に生産者・消費者を保持。
- `Diagnostic`：severity、code、message、source、object_id。構造上特定できないオブジェクトIDはnull。
- `LoadReport<T>`：data、diagnostics、files_loaded、files_failed、incomplete。
- `Progress`：completed、total、file。

IDは `industry:<internal_name>` / `goods:<internal_name>`。参照はすべてIDで接続します。未定義貨物は `unresolved=true`、source=nullのノードとして残します。

## IPCと読み込み

`normalize_sources` は複数フォルダを正規化して重複を除外し、ファイルをドロップした場合はエラーにします。`load_sources` はpathsと進捗Channelを受け、Graphを含むLoadReportを返します。

解析は `spawn_blocking` で実行し、AtomicBoolとRAIIガードで同時実行を防ぎます。UIも操作を無効化して二重要求を防ぎます。結果は1回のIPC応答で送信し、ノード展開に追加IPCは不要です。

読み込み元の変更と解析済みスナップショットを分離します。利用可能なデータがある結果を採用し、全失敗や空データの場合は既存結果を維持します。部分的な結果は不完全フラグを添えて採用します。

## 表示モデル

GraphのオブジェクトIDとは別に `root/0/1` のような表示インスタンスIDを持ちます。展開状態は表示IDのSetです。表示ツリーは祖先経路に同じオブジェクトIDがあるときだけ循環と判定します。別の枝で現れる同一オブジェクトは展開可能です。

折り畳みでは該当インスタンス以下の展開状態を削除します。展開は候補ツリーを構築して1,000ノード以下か確認してから反映します。上限超過時に部分的な枝を追加することはありません。

Dagreは表示中のツリーだけを上から下へ配置します。再配置前後の操作ノードの位置差でviewportを補正します。React Flowは画面外のノード描画を省略します。グラフ領域は絶対配置の内側要素で高さを確定させ、Flexレイアウト下でも描画領域が0にならないようにしています。

## ファイル処理

- 指定フォルダ直下のみ列挙し、拡張子の大小文字を区別せず `.pak` を選択。
- 同一ソースはファイル名のRust辞書順（大小文字区別）、同一ファイルは格納順。後の定義を採用。
- 解析失敗したPAKはファイル単位で除外。他ファイルは継続。
- ファイル上限256 MiB、翻訳上限16 MiB、PAK深度128、ノード総数100万。切断・サイズ範囲外を検出。
- 画像はデコードせず、ノード本体を参照または読み飛ばす。PAKは1ファイルずつ読み込む。
- 翻訳・Registryをすべて統合してから参照欠落を判定。

全ファイルのバイナリを永続保存しません。解析後は関係・出典情報だけが残ります。

