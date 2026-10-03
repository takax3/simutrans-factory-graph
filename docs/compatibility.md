# PAK互換性と検証

## 参照した公式実装

Simutrans Standardコミット：
[`f19fe4c8d42ddf0e719ea5ff43ab69d3a8d3cf84`](https://github.com/simutrans/simutrans/tree/f19fe4c8d42ddf0e719ea5ff43ab69d3a8d3cf84)

参照箇所（すべて `src/simutrans` 配下）：

- `dataobj/pakset_manager.cc`：ヘッダ、コンパイラバージョン、再帰ノード読み取り。
- `descriptor/objversion.h` / `obj_node_info.h`：ノード識別子とサイズ形式。
- `descriptor/reader/factory_reader.cc` / `good_reader.cc` / `xref_reader.cc`：形式バージョンと貨物参照。
- `descriptor/factory_desc.h` / `descriptor/writer/factory_writer.cc`：Building経由の名前とSupplier／Productの配置。
- `dataobj/translator.cc`：日本語翻訳ファイル名、UTF-8マーカー、キー／値形式。

公式ソースを参照して必要な読み取り処理を独立実装しています。画像についても固定コミットのimage_reader、building_reader、building_desc、gebaeude、simgraph16、ground_descを参照しています。数量・立地など、表示しない属性の意味解釈は行いません。

## 対応表

| 要素 | 対応範囲・扱い |
|---|---|
| ファイルヘッダ | 0x1A終端のテキスト＋little-endian u32コンパイラコード |
| コンパイラコード | 1001〜1003 |
| ノード | 4バイト種別、u16子数、u16本体長。1001以外は0xFFFF長の後にu32長 |
| FACT | Standard v0〜v6。名前は先頭BUILの先頭TEXT |
| 入出力数 | FACT本体のoffset 12／14のu16 |
| FSUP | 旧形式6バイト、および末尾未使用2バイトを含む8バイト |
| FPRO | v0／v1 |
| GOOD | v0〜v4。先頭TEXTから名前取得 |
| XREF | 対象種別4バイト＋必須フラグ1バイト＋NUL終端名 |
| 入力／出力 | FACT子のindex 2以降、FSUP／FPRO先頭XREFのGOOD参照 |
| 名前文字列 | UTF-8。旧PAKの非UTF-8バイトはLatin-1として保持 |
| 日本語翻訳 | 各ソースの`text/ja.tab`、`text/ja.*.tab`、`text/*.ja.tab`。UTF-8、BOM／先頭§に対応 |
| 建物画像 | BUIL v5〜10、TILE v2、IMG1／IMG2、IMG v1／v3 |
| 基準タイル幅 | GRND Outsideの最初の画像幅。ベースPAKからアドオンへ継承 |
| 合成 | layout 0、season 0、frame 0。背景の高さ別画像と前景をタイル座標・画像オフセットに従って合成 |
| 色 | 昼間、プレイヤー0の既定色（青／黄）。RGB555、特殊色、RGB343半透明。夜間・発光効果なし |
| 非対象オブジェクト | 構造を辿って除外。地形はOutside幅だけを参照。CLIは画像をデコードしない |

Standardの読取実装と同様に最上位ノードを1つ読み、その後の余剰バイトは無視します。ROOT配下のFACT／GOODに加え、直接FACT／GOODが置かれる場合も扱います。pak128.Japanの2ファイルにある種別0のトップレベルノードは関連オブジェクトなしとして扱います。

FACT／GOODの未知バージョンやExtended形式はエラーとしてそのPAKを除外します。すべての歴史的PAKやExtended互換性を保証するものではありません。

同じソース内の重複はファイル名順・格納順で後勝ちとし、警告します。本体のOS依存のファイル列挙順を再現する仕様ではありません。翻訳もソース順、同一ソース内ファイル名順で統合し、後の有効な訳を採用します。翻訳がなければ内部名を表示します。Simutrans本体の言語定義ファイルや`compat.tab`の旧名エイリアスは初期版では読み込みません。

## 固定した検証用配布物

第三者PAKはアプリ・ソースリポジトリに同梱しません。検証用ダウンロードは `.reference` にのみ保存し、Git対象外にしています。

### pak128.Japan 120.0

- 公式配布：[pak128.japan.120.0.cab](http://pak128.jpn.org/souko/pak128.japan.120.0.cab)
- SHA256：`7493a9615761e799879b7902281c254a1977fba23f4d1040903ee2be8148d472`
- 検証結果：524 PAK、48産業、63貨物、116入出力関係、診断0件。
- 配布時のFACTはv2が17件・v3が31件、GOODはv2が63件。複数Factoryを含む `factory.konbini.pak` も検証済み。

### pak64 124.3

- 公式配布：[simupak64-124-3.zip](https://sourceforge.net/projects/simutrans/files/pak64/124-3/simupak64-124-3.zip/)
- 取得に使用した同一配布物のミラー：[FreeBSD distcache](http://distcache.FreeBSD.org/ports-distfiles/simupak64-124-3.zip)
- SHA256：`ecde0e15301320549e92a9113fcdd1ada3b7f9aa1fce3d59a5dc98d56d648756`
- 検証結果：780 PAK、40産業、23貨物、61入出力関係、診断0件。
- 配布時のFACTはv5が40件、GOODはv3が23件。

アーカイブ以外に、ファイル名とPAK内容を連結したSHA256も `pakset-baselines.json` で固定しています。`scripts/verify-paksets.mjs` は件数・関係の相互整合性・ハッシュを確認します。

## 元の定義との照合

画像回帰確認ではJapan 120.0の48産業、pak64 124.3の40産業すべてからPNGを生成でき、画像エラー0件を確認しています。Japanの旧IMG v1では、切り詰められた画像幅の外側にゼロ長の終端ランを持つデータがあり、公式リーダーと同じく許容します。画素の書き込み範囲は別途検証します。

KshinserverNEO2のユーザー提供Paksetでは、DIYセンター（MaterialsWholesales）や製材所（Saegewerk）がBUIL v9を使用しています。v8と同じ建物寸法・タイル配置の読み取りで対応します。半透明画像は空白ランの上位ビットもマスクし、0x8000を「隙間0の継続」として扱います。行終端は生の値が0の場合だけです。

同Paksetの246産業すべてでPNG生成を確認しました（139貨物、607関係、画像エラー0件）。`node scripts/native-preview-smoke.mjs PAK_DIRECTORY` はビルド済みの実アプリでDIYセンターと製材所の表示、実IPCの全画像件数を確認します。標準出力先以外のアプリを使う場合は `APP_EXE` で指定できます。Paksetそのものと抽出画像は同梱しません。

`cargo run -p pak-core --example preview_probe -- OUTPUT_DIRECTORY SOURCE_DIRECTORY...` で開発用にPNGと件数・寸法レポートを生成できます。出力には `.reference/previews` などGit対象外のディレクトリを指定してください。人工画像でタイル配置・階層・前景・色・透明余白のピクセル比較を行い、実PAKの弁当工場・製鉄所なども合成画像を目視確認しています。ゲームを起動した画面との直接比較は未実施です。

公開されている日本版ソースは120.0と同版ではなく112.0です。この違いを前提に、120.0と同じ入出力を持つ代表8産業を照合しました。全産業が112.0の定義に一致すると主張するものではありません。

- ソース：[sources.pak128.japan.112.0.cab](http://pak128.jpn.org/souko/sources.pak128.japan.112.0.cab)
- SHA256：`e567f2505c4e09b111ed6e8fa52058f9fb161b2f65380d7543981358f033c7ca`
- 一致確認済み：`suiden`、`komesouko`、`hatake`、`noukyou_souko`、`supermarket`、`bento_plant`、`fish_processing_plant`、`uoichiba`。

例：`supermarket → bento12 → bento_plant → hakumai3 → komesouko → genmai2 → suiden` の依存関係と、弁当工場が併せて要求する加工魚・野菜を確認しています。

## 検証方法

- Rust：PAKの各対応バージョン、切断データ、巨大画像、参照不足、ソース順・同一ソース重複、日本語パス・翻訳、複数生産者、循環。
- UI単体：産業／貨物検索、共有ノード、祖先循環、枝単位の折り畳み、1,000ノード制限、進捗、二重実行防止、読み込み失敗時の前回結果保持。
- Native smoke：ビルド済みWebView2と実Rust IPC。Tauriドロップイベントを注入し、日本版の読み込み・産業起点・貨物起点・展開・折り畳み・循環停止を検証。

ネイティブのフォルダ選択ダイアログ操作と、Explorerからウィンドウへ実際にドラッグする操作は手動確認対象です。署名証明書は設定していません。

## 今回の実行結果（2026-10-03）

- Rustテスト9件、UIテスト11件：成功。
- Rust core / CLIのClippy（警告をエラー扱い）、Rust整形、TypeScript型検査、本番UIビルド：成功。
- 上記2つの実Paksetのハッシュ・件数・相互参照検証、公開DATの8産業照合：成功。
- Windows x64実行ファイルとNSISインストーラ生成：成功。
- 日本語・空白を含む作業フォルダ内への一時インストール：成功。
- インストール済みアプリでNative smokeを実行し、読み込み・日本語名検索・内部名検索・産業起点・貨物起点・展開・折り畳み・循環停止を確認：成功。
- 検証後にテスト用インストールをアンインストールし、アンインストール登録とインストール先の除去を確認。

WebView2が既に存在するWindows環境で検証しました。未導入環境でのランタイム取得と、GitHub Actions上での実行はこの作業では未確認です。
