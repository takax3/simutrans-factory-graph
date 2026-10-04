# Makeobj互換性と検証状況

確認日: 2026-10-04。対象: 現在のpak-coreとStandard形式。

## 結論

確認したStandardのFACT v0～v6 / GOOD v0～v4について、名前と貨物の入出力を読む実装は仕様と一致する。画像はBUIL v0～v12、TILE v0～v2、IMG v0～v3に対応し、旧形式から確認時の公式writerの形式まで読み分ける。全Makeobjリリースの実生成物との完全互換性は未確認で、Extended/Experimentalは対象外。

Makeobjの製品バージョン、PAKコンテナ形式、各ノードの形式バージョンは別物。同じコンテナ1003でも建物などのノード形式が異なる。コンテナを受け付けることだけで全リリース互換とは判断できない。

## 対応表

| 構成要素 | 現在の実装 | 判定 |
|---|---|---|
| コンテナ | 1001～1003 | 1001は16bit長、1002/1003は0xffff時に32bit長を読む |
| FACT | v0～v6、本体最小長16/18/18/38/43/80/81 | 確認したStandard readerと一致 |
| 入出力件数 | 全FACT形式でoffset 12/14 | v0の予約word、v1の16bit色、v2以降の8bit色+fieldsを含め一致 |
| 子ノード | BUIL、煙、FSUP群、FPRO群 | 公式factory writerの配置と一致。末尾の畑等は関係解析では使わない |
| FSUP | 本体長6または8、先頭子のGOOD XREF | 旧readerが消費する6byteとwriterの8byteに対応 |
| FPRO | v0/v1、最小4/6byte | 旧・現行形式の貨物参照を読める |
| GOOD | v0～v4、最小4/8/10/10/16byte | 公式good readerと一致。運賃等は解析対象外 |
| BUIL画像 | v0～v12 | 形式ごとの寸法・レイアウト数の位置を読み分ける |
| TILE画像 | v0～v2 | v0の予約ポインタと、v0/v1の季節情報省略に対応 |
| IMG画像 | v0～v3 | 旧ヘッダ、左端補正、v0のプレイヤー色補正に対応 |

## 画像形式の読み分け

- BUIL v0は寸法がoffset 16/18、レイアウト数がoffset 20の32bit値。v1～v11は寸法がoffset 10/12、レイアウト数がoffset 14の8bit値。確認時の公式building writerが生成するv12は、それぞれoffset 9/11/13へ移動している。
- TILE v0は予約ポインタを含み、タイルindexがoffset 6。v1/v2はindexがoffset 4。v0/v1は季節情報を省略する。最初の季節の背景・前景を抽出する。
- IMG v0は12byteヘッダ、8bitの位置・寸法、32bitのデータ長を持つ。v1/v2は10byteヘッダ、16bitの位置、8bitの寸法、16bitのデータ長を持つ。v3は10byteヘッダで寸法も16bitとなる。
- IMG v0/v1は各行の最小左端を基準にRLEの位置を補正する。v2/v3は補正しない。v0の旧プレイヤー色値はStandard readerに合わせて補正する。

表示するのは最初の向き・季節・フレームの静止画。Outsideの画像幅からタイル幅を取得し、アドオンにOutsideがなければ先行フォルダの幅を継承する。幅を判定できない場合は画像を省略する。

画像抽出失敗は産業の採用を妨げない。デスクトップではimage_error警告になり、関係グラフのincompleteは変更されない。そのためグラフが完全でも画像の互換性は保証されない。

## 実行した検証

- `scripts/cargo.ps1 test -p pak-core`: 22テスト成功。
- `scripts/cargo.ps1 clippy -p pak-core -p pak-cli '--' -D warnings`: 成功。
- 追加テスト: コンテナ3形式 × FACT 7形式 × FSUP 2長 × FPRO 2形式 = 84組で、入力2貨物・出力1貨物の保持を確認。既存のバージョン試験が入出力件数0だった点を補強した。
- `scripts/verify-paksets.mjs`: Japan 120.0は524ファイル / 48産業 / 63貨物 / 116関係、pak64 124.3は780ファイル / 40産業 / 23貨物 / 61関係。両方成功し、ファイル群のSHA256も既存baselineと一致。
- Japan 112.0の公開DATとの代表8産業の入出力照合も成功。120.0と同版のDATではない。
- 画像の合成テスト: BUIL 13形式 × TILE 3形式 × IMG 4形式 = 156組を読み込みAPIからPNG生成まで処理し、同じテスト画像の出力が一致することを確認。
- 旧画像の位置、左端補正、プレイヤー色補正、データ切断・長さ不正の検出も検証。
- `preview_probe`: Japan 120.0の48産業、pak64 124.3の40産業すべてのPNG生成に成功。双方とも画像エラー・読み込み診断0件。成果物はGit管理対象外の`.reference/previews/compat-japan`と`compat-pak64`に保存。

合成テストは各Makeobj実行ファイルで生成した実PAKではない。全過去リリースのwriter履歴・実行ファイルを網羅した調査は実施していない。したがって「今までの全バージョン」の証明にはならない。

## その他の互換性の境界

- コンテナ1001未満・1003超、未知FACT/GOOD/FPROは拒否する。BUIL v13以降、TILE v3以降、IMG v4以降は画像のエラーとして扱う。
- 読み込みはPAKファイル単位。1つの未対応FACT/GOODがあると、同梱の対応オブジェクトもそのファイルから採用されない。
- BUIL本体は関係解析時にバージョン検証しない。名前TEXTが読めることと、建物の全構造が正しいことは別。
- 非UTF-8文字列は各byteをUnicode文字に置き換える。旧日本語エンコーディングの復元は行わないため、表示やUTF-8翻訳との照合には限界がある。
- 直下のPAKのみ列挙。安全上限はファイル256MiB、深度128、100万ノード。画像素材128MiB、キャンバス4096px等もある。
- 年代、生産量、立地、煙、畑、運賃のゲーム上の挙動は解析対象外。

## 照合元

ローカル`.reference`のStandard reader/writer（parserの記載上の基準はf19fe4c8）と、確認時の公式masterの以下を照合。ローカル参照ファイルはGit管理対象外。masterは将来変更され得る。

- [factory writer](https://github.com/simutrans/simutrans/blob/master/src/simutrans/descriptor/writer/factory_writer.cc)
- [factory reader](https://github.com/simutrans/simutrans/blob/master/src/simutrans/descriptor/reader/factory_reader.cc)
- [good reader](https://github.com/simutrans/simutrans/blob/master/src/simutrans/descriptor/reader/good_reader.cc)
- [building writer](https://github.com/simutrans/simutrans/blob/master/src/simutrans/descriptor/writer/building_writer.cc)
- [image reader](https://github.com/simutrans/simutrans/blob/master/src/simutrans/descriptor/reader/image_reader.cc)
- [objversion.h](https://github.com/simutrans/simutrans/blob/master/src/simutrans/descriptor/objversion.h)

## 実装・テスト

- [関係解析](../crates/pak-core/src/parser.rs)
- [画像抽出・デコード・合成](../crates/pak-core/src/preview.rs)
- [関係解析テスト](../crates/pak-core/tests/reader.rs)
- [画像読み込みテスト](../crates/pak-core/tests/previews.rs)
- [実paksetの関係検証](../scripts/verify-paksets.mjs)
- [実画像の生成検証](../crates/pak-core/examples/preview_probe.rs)
