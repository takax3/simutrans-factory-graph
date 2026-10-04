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

`normalize_sources` は複数フォルダを正規化して重複を除外し、ファイルをドロップした場合はエラーにします。`load_sources` はpathsと進捗Channelを受け、Graphを含むLoadReportに `previews` を追加して返します。`previews` は産業IDをキーとし、PNG data URLと幅・高さを持ちます。進捗のstageは `pak`／`images` です。CLIのJSONと既存の関係解析APIは維持します。

解析は `spawn_blocking` で実行し、AtomicBoolとRAIIガードで同時実行を防ぎます。UIも操作を無効化して二重要求を防ぎます。結果は1回のIPC応答で送信し、ノード展開に追加IPCは不要です。

読み込み元の変更と解析済みスナップショットを分離します。利用可能なデータがある結果を採用し、全失敗や空データの場合は既存結果を維持します。部分的な結果は不完全フラグを添えて採用します。

## 表示モデル

GraphのオブジェクトIDとは別に `root/u0/u1` のような表示インスタンスIDを持ちます。uは上流、dは下流の枝です。展開状態は「表示ID＋方向」のSetです。起点は両方向を独立して操作でき、上流の枝では上流のみ、下流の枝では下流のみを展開できます。UIだけでなくツリー構築・展開操作でも逆方向を除外し、起点を共有する左右2本の木を維持します。表示ツリーは祖先経路に同じオブジェクトIDがあるときだけ循環と判定します。別の枝で現れる同一オブジェクトは展開可能です。

折り畳みでは選択した方向の枝以下の展開状態だけを削除します。展開は候補ツリーを構築して左右合計1,000ノード以下か確認してから反映します。上限超過時に部分的な枝を追加することはありません。初期表示は起点の左右各1段です。Dagreには上流→操作ノード、操作ノード→下流の順で配置制約を渡し、左から右へ配置し、各ノードの上流を左、下流を右に置きます。描画する線の矢印は探索方向で、上流の線は左、下流の線は右を向きます。起点は赤枠とラベルで区別します。

Dagreは表示中のツリーだけを左から右へ配置します。再配置前後の操作ノードの位置差でviewportを補正します。React Flowは画面外のノード描画を省略します。グラフ領域は絶対配置の内側要素で高さを確定させ、Flexレイアウト下でも描画領域が0にならないようにしています。

## ファイル処理

- 指定フォルダ直下のみ列挙し、拡張子の大小文字を区別せず `.pak` を選択。
- 同一ソースはファイル名のRust辞書順（大小文字区別）、同一ファイルは格納順。後の定義を採用。
- 解析失敗したPAKはファイル単位で除外。他ファイルは継続。
- PAKファイル上限4 GiB（1ファイル単位）、翻訳上限16 MiB、PAK深度128、ノード総数100万。切断・サイズ範囲外を検出。PAK全体をメモリに読むため、大きなファイルではそのサイズに加えて解析用のメモリが必要。
- PAKは1ファイルずつ読み込み、デスクトップ読み込み時だけlayout 0／season 0／frame 0の建物画像素材を保持する。Registryの画像素材はJSON対象外。
- 各フォルダのOutside画像幅を基準タイル幅とし、Outsideがないアドオンは先行フォルダの幅を継承する。幅不明なら画像だけ省略する。
- 上書き後の各産業を1回合成し、透明余白を切り取って長辺512px以内のPNGにする。UIは解析結果と画像を同時に置換し、展開や起点変更では画像を再生成しない。
- 合成キャンバスは4096×4096px、保持素材は128MiB、生成PNGは64MiBが上限。画像だけの失敗は採用元と産業ID付きの `image_error` 警告として扱い、関係グラフの `incomplete` は変更しない。
- 翻訳・Registryをすべて統合してから参照欠落を判定。

全ファイルのバイナリを永続保存しません。デスクトップ解析後は関係・出典情報とプレビューPNGだけをUIに渡し、Rust側の画像素材は解放します。
