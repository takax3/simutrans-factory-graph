import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  Factory,
  FolderOpen,
  GitFork,
  GripVertical,
  Layers,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import * as api from './api';
import type { BaseObject, IndustryGraph, LoadReport, Progress, PreviewImage } from './types';
import IndustryImage from './IndustryImage';
import { categoryKey, categoryLabel, categoryOptions } from './categories';
import { lookup, searchObjects } from './exploration';
import GraphView from './GraphView';

type Screen = 'sources' | 'select' | 'graph';
const friendlyPath = (path: string) =>
  path.startsWith('\\\\?\\UNC\\') ? '\\\\' + path.slice(8) : path.replace(/^\\\\\?\\/, '');
const folderName = (path: string) => friendlyPath(path).split(/[\\/]/).filter(Boolean).pop();

function Diagnostics({ report }: { report: LoadReport }) {
  return (
    <section className="load-result" aria-label="読み込み結果">
      <div className="result-heading">
        {report.incomplete ? <TriangleAlert size={19} /> : <Check size={19} />}
        <strong>
          {report.incomplete ? '一部のデータを読み込めませんでした' : '読み込みが完了しました'}
        </strong>
      </div>
      <div className="metrics">
        <span>
          <b>{Object.keys(report.data.industries).length}</b> 産業
        </span>
        <span>
          <b>{Object.keys(report.data.goods).length}</b> 貨物
        </span>
        <span>{report.files_loaded} ファイル読み込み済み</span>
      </div>
      {report.diagnostics.length > 0 && (
        <details>
          <summary>診断 {report.diagnostics.length} 件を確認</summary>
          <ul className="diagnostics">
            {report.diagnostics.map((d, i) => (
              <li key={i}>
                <span className={`badge ${d.severity === 'error' ? 'danger' : ''}`}>
                  {d.severity === 'error' ? 'エラー' : '警告'}
                </span>{' '}
                {d.message}
                {d.object_id && <code>{d.object_id}</code>}
                {d.source && <small>{friendlyPath(d.source.file)}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ObjectPreview({
  graph,
  object,
  image,
}: {
  graph: IndustryGraph;
  object: BaseObject;
  image?: PreviewImage;
}) {
  const industry = graph.industries[object.id];
  const good = graph.goods[object.id];
  const rows: [string, string[]][] = industry
    ? [
        ['要求する貨物', industry.inputs],
        ['生産する貨物', industry.outputs],
      ]
    : [
        ['生産する産業', good.producers],
        ['消費する産業', good.consumers],
      ];
  return (
    <>
      <span className={`kind-label ${industry ? '' : 'goods-text'}`}>
        {industry ? <Factory size={15} /> : <Box size={15} />}
        {industry ? '産業' : '貨物'}
      </span>
      <h2>{object.display_name}</h2>
      <p className="internal-name">{object.internal_name}</p>
      {industry && (
        <IndustryImage
          key={image?.data_url ?? object.id}
          image={image}
          name={object.display_name}
          detail
        />
      )}
      {good && <p className="goods-category">カテゴリ: {categoryLabel(good)}</p>}
      {good?.unresolved && <p className="notice">定義が見つからない貨物です。</p>}
      {rows.map(([label, ids]) => (
        <section className="relation-group" key={label}>
          <h3>
            {label}
            <span>{ids.length}</span>
          </h3>
          {ids.length ? (
            <ul>
              {ids.map((id) => (
                <li key={id}>
                  <span className={industry ? 'goods-dot' : 'industry-dot'} />
                  {lookup(graph, id)?.display_name ?? id}
                  <small>{lookup(graph, id)?.internal_name}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">なし</p>
          )}
        </section>
      ))}
      {object.source && (
        <div className="provenance">
          <h3>読み込み元</h3>
          <p title={friendlyPath(object.source.file)}>{friendlyPath(object.source.file)}</p>
          {object.overridden.length > 0 && (
            <details>
              <summary>{object.overridden.length} 件の定義を上書き</summary>
              {object.overridden.map((s, i) => (
                <p key={i}>
                  {friendlyPath(s.file)} (#{s.object_index})
                </p>
              ))}
            </details>
          )}
        </div>
      )}
    </>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('sources');
  const [sources, setSources] = useState<string[]>([]);
  const [loadedSources, setLoadedSources] = useState<string[]>([]);
  const [report, setReport] = useState<LoadReport | null>(null);
  const [attempt, setAttempt] = useState<LoadReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [failedReload, setFailedReload] = useState(false);
  const [tab, setTab] = useState<'industry' | 'goods'>('industry');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState('');
  const [root, setRoot] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const current = useRef({ screen, busy, adding });
  current.current = { screen, busy, adding };
  const addingLock = useRef(false);
  const loadLock = useRef(false);
  const dirty = JSON.stringify(sources) !== JSON.stringify(loadedSources);
  const usable =
    !!report &&
    (Object.keys(report.data.industries).length > 0 || Object.keys(report.data.goods).length > 0);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [screen]);

  const addFolders = useCallback(async (paths: string[]) => {
    if (
      !paths.length ||
      current.current.screen !== 'sources' ||
      loadLock.current ||
      addingLock.current
    )
      return;
    addingLock.current = true;
    setAdding(true);
    setError('');
    try {
      const normalized = await api.normalizeSources(paths);
      setSources((old) => [...new Set([...old, ...normalized])]);
    } catch (e) {
      setError(String(e));
    } finally {
      addingLock.current = false;
      setAdding(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    api
      .listenDrop((paths) => {
        void addFolders(paths);
      })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [addFolders]);

  async function choose() {
    try {
      await addFolders(await api.chooseFolders());
    } catch (e) {
      setError(String(e));
    }
  }
  function move(from: number, to: number) {
    if (busy || adding || to < 0 || to >= sources.length || from === to) return;
    setSources((old) => {
      const next = [...old];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  }
  async function load() {
    if (loadLock.current || addingLock.current || !sources.length) return;
    loadLock.current = true;
    setBusy(true);
    setError('');
    setProgress(null);
    setAttempt(null);
    setFailedReload(false);
    try {
      const result = await api.loadSources(sources, setProgress);
      setAttempt(result);
      if (Object.keys(result.data.industries).length || Object.keys(result.data.goods).length) {
        setReport(result);
        setLoadedSources([...sources]);
        setRoot('');
        setSelected('');
        setQuery('');
        setCategory('all');
      } else {
        setError('利用できる産業・貨物がありません。読み込み元と診断を確認してください。');
        setFailedReload(true);
      }
    } catch (e) {
      setError(String(e));
      setFailedReload(true);
    } finally {
      setBusy(false);
      loadLock.current = false;
    }
  }

  const graph = report?.data;
  const categories = categoryOptions(Object.values(graph?.goods ?? {}));
  const objects = graph
    ? searchObjects<BaseObject>(
        Object.values(tab === 'industry' ? graph.industries : graph.goods).filter(
          (object) =>
            tab === 'industry' ||
            category === 'all' ||
            categoryKey(graph.goods[object.id]) === category,
        ),
        query,
      )
    : [];
  const selectedObject = graph && selected ? lookup(graph, selected) : undefined;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <GitFork size={23} />
          </div>
          <div>
            <strong>Factory Graph</strong>
            <span>SIMUTRANS · INDUSTRY EXPLORER</span>
          </div>
        </div>
        <nav aria-label="手順" className="steps">
          {(['sources', 'select', 'graph'] as const).map((step, i) => (
            <div key={step} className={screen === step ? 'step active' : 'step'}>
              {i > 0 && <ChevronRight size={14} />}
              <button
                disabled={busy || (step !== 'sources' && (!usable || (step === 'graph' && !root)))}
                onClick={() => setScreen(step)}
                aria-current={screen === step ? 'step' : undefined}
              >
                <span>{i + 1}</span>
                {['読み込み元', '起点を選択', 'グラフを探索'][i]}
              </button>
            </div>
          ))}
        </nav>
        <span className="version">STANDARD / v0.1</span>
      </header>

      {screen === 'sources' && (
        <main className="page sources-page">
          <div className="page-heading">
            <div>
              <div className="eyebrow">01 / DATA SOURCES</div>
              <h1>産業チェーンを、読み込む。</h1>
              <p>PaksetやAddonのフォルダを追加して、産業と貨物のつながりを探索します。</p>
            </div>
            <span className="local-badge">
              <span /> ローカルで解析
            </span>
          </div>
          <div className="source-layout">
            <div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      <Layers size={18} /> 読み込み元
                    </h2>
                    <p>下にあるフォルダほど優先されます</p>
                  </div>
                  <span className="count-badge">{sources.length} フォルダ</span>
                </div>
                <div className="source-list">
                  {sources.map((path, i) => (
                    <div
                      className={`source-row ${dragIndex === i ? 'dragging' : ''}`}
                      data-source-index={i}
                      key={path}
                    >
                      <button
                        className="icon-button drag-handle"
                        aria-label={`${folderName(path)}をドラッグして並び替え`}
                        disabled={busy || adding}
                        onPointerDown={(e) => {
                          if (busy || adding) return;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setDragIndex(i);
                        }}
                        onPointerUp={(e) => {
                          if (dragIndex === null) return;
                          const target = document
                            .elementFromPoint(e.clientX, e.clientY)
                            ?.closest('[data-source-index]');
                          if (target)
                            move(dragIndex, Number(target.getAttribute('data-source-index')));
                          setDragIndex(null);
                        }}
                        onPointerCancel={() => setDragIndex(null)}
                      >
                        <GripVertical size={17} />
                      </button>
                      <span className="source-number">{String(i + 1).padStart(2, '0')}</span>
                      <FolderOpen size={23} className="folder-icon" />
                      <div className="source-path">
                        <strong>{folderName(path)}</strong>
                        <small title={friendlyPath(path)}>{friendlyPath(path)}</small>
                      </div>
                      <div className="source-actions">
                        <button
                          className="icon-button"
                          disabled={busy || adding || i === 0}
                          aria-label={`${folderName(path)}を上へ`}
                          onClick={() => move(i, i - 1)}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={busy || adding || i === sources.length - 1}
                          aria-label={`${folderName(path)}を下へ`}
                          onClick={() => move(i, i + 1)}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={busy || adding}
                          aria-label={`${folderName(path)}を削除`}
                          onClick={() => setSources((old) => old.filter((p) => p !== path))}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className={`drop-zone ${sources.length ? 'compact' : ''}`}>
                  <div className="drop-icon">
                    <FolderOpen size={29} strokeWidth={1.5} />
                  </div>
                  <strong>フォルダをここへドラッグ＆ドロップ</strong>
                  <p>または、フォルダを選んで追加</p>
                  <button
                    className="secondary"
                    disabled={busy || adding}
                    onClick={() => void choose()}
                  >
                    <Plus size={17} />
                    フォルダを追加
                  </button>
                </div>
                <div className="panel-footer">
                  <span>
                    <CircleHelp size={15} /> フォルダ直下の .pak を読み込みます
                  </span>
                  <button
                    className="primary"
                    disabled={busy || adding || !sources.length}
                    onClick={() => void load()}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle className="spin" size={17} />
                        読み込み中
                      </>
                    ) : (
                      <>
                        読み込みを開始
                        <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                </div>
              </section>
              {busy && (
                <div className="progress-box" role="status">
                  <progress
                    value={progress?.completed ?? 0}
                    max={Math.max(progress?.total ?? 1, 1)}
                  />
                  <span>
                    {progress
                      ? `${progress.stage === 'images' ? '産業画像生成' : 'PAK解析'} ${progress.completed} / ${progress.total} ${progress.stage === 'images' ? '産業' : 'ファイル'}`
                      : '解析を準備しています…'}
                  </span>
                  <small>{progress?.file && folderName(progress.file)}</small>
                </div>
              )}
              {error && (
                <div role="alert" className="error-message">
                  <TriangleAlert size={18} />
                  <span>{error}</span>
                </div>
              )}
              {attempt && <Diagnostics report={attempt} />}
              {usable && !busy && (
                <div className="continue-row">
                  {dirty && (
                    <span className="muted">構成を変更しました。再読み込みが必要です。</span>
                  )}
                  <button
                    className={dirty || failedReload ? 'secondary' : 'primary'}
                    onClick={() => setScreen('select')}
                  >
                    {dirty || failedReload ? '前回の解析結果を開く' : '起点を選択する'}
                    <ArrowRight size={17} />
                  </button>
                </div>
              )}
            </div>
            <aside className="source-guide">
              <div className="eyebrow">EXPLORE YOUR PAKSET</div>
              <h2>
                「何が必要？」を、
                <br />
                ひとつずつ辿る。
              </h2>
              <div className="mini-chain">
                <div>
                  <Factory size={18} />
                  <span>消費する産業</span>
                </div>
                <span className="chain-line" />
                <div className="mini-goods">
                  <Box size={18} />
                  <span>必要な貨物</span>
                </div>
                <span className="chain-line" />
                <div>
                  <Factory size={18} />
                  <span>生産する産業</span>
                </div>
              </div>
              <p>
                産業と貨物を交互に展開して、
                <br />
                原料までのつながりを確認できます。
              </p>
              <hr />
              <h3>Addonも一緒に</h3>
              <p>基本Paksetの下にAddonを追加すると、同名の定義を上書きして解析します。</p>
              <small>
                ファイルは変更されません。
                <br />
                解析データは端末内で処理されます。
              </small>
            </aside>
          </div>
        </main>
      )}

      {screen === 'select' && graph && (
        <main className="page selection-page">
          <div className="page-heading">
            <div>
              <div className="eyebrow">02 / STARTING POINT</div>
              <h1>どこから辿りますか？</h1>
              <p>産業または貨物を選び、必要な原料と生産元を確認しましょう。</p>
            </div>
            <button className="secondary" onClick={() => setScreen('sources')}>
              <FolderOpen size={16} />
              読み込み設定
            </button>
          </div>
          {report.incomplete && (
            <p className="notice">
              <TriangleAlert size={16} />
              一部のデータが欠けています。診断は読み込み設定で確認できます。
            </p>
          )}
          <div className="selection-layout">
            <section className="panel object-picker">
              <div className="tabs" role="tablist" aria-label="起点の種類">
                <button
                  role="tab"
                  aria-selected={tab === 'industry'}
                  onClick={() => {
                    setTab('industry');
                    setSelected('');
                  }}
                >
                  <Factory size={17} />
                  産業<span>{Object.keys(graph.industries).length}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={tab === 'goods'}
                  onClick={() => {
                    setTab('goods');
                    setSelected('');
                  }}
                >
                  <Box size={17} />
                  貨物<span>{Object.keys(graph.goods).length}</span>
                </button>
              </div>
              <div className="search-box">
                <Search size={18} />
                <input
                  aria-label="名前で検索"
                  placeholder="名前・内部名で検索…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button onClick={() => setQuery('')} aria-label="検索をクリア">
                    ×
                  </button>
                )}
              </div>
              {tab === 'goods' && (
                <label className="category-filter">
                  カテゴリ
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="all">すべて</option>
                    {categories.map(({ key, label }) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="list-caption">
                {objects.length} 件の{tab === 'industry' ? '産業' : '貨物'}
                <span>名前順</span>
              </div>
              <div className="object-list">
                {objects.map((object) => (
                  <button
                    key={object.id}
                    className={`object-row ${object.id === selected ? 'selected' : ''}`}
                    onClick={() => setSelected(object.id)}
                  >
                    <span className={`object-icon ${tab === 'goods' ? 'goods-icon' : ''}`}>
                      {tab === 'industry' ? (
                        <IndustryImage
                          image={report.previews?.[object.id]}
                          name={object.display_name}
                        />
                      ) : (
                        <Box size={18} />
                      )}
                    </span>
                    <span>
                      <strong>{object.display_name}</strong>
                      <small>{object.internal_name}</small>
                      {tab === 'goods' && (
                        <span className="goods-category">
                          {categoryLabel(graph.goods[object.id])}
                        </span>
                      )}
                      {tab === 'goods' && (
                        <span className="goods-relations">
                          <span
                            className={
                              graph.goods[object.id].producers.length === 0
                                ? 'missing-relation'
                                : undefined
                            }
                          >
                            生産元 {graph.goods[object.id].producers.length}
                          </span>
                          <span aria-hidden="true">/</span>
                          <span
                            className={
                              graph.goods[object.id].consumers.length === 0
                                ? 'missing-relation'
                                : undefined
                            }
                          >
                            消費先 {graph.goods[object.id].consumers.length}
                          </span>
                        </span>
                      )}
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
                {!objects.length && (
                  <div className="empty-state">
                    <Search size={26} />
                    <h3>一致する項目がありません</h3>
                    <p>検索条件やカテゴリを変更してください。</p>
                  </div>
                )}
              </div>
            </section>
            <section className="panel preview-panel">
              {selectedObject ? (
                <>
                  <div className="preview-content">
                    <ObjectPreview
                      graph={graph}
                      object={selectedObject}
                      image={report.previews?.[selectedObject.id]}
                    />
                  </div>
                  <div className="preview-footer">
                    <button
                      className="primary"
                      onClick={() => {
                        setRoot(selected);
                        setScreen('graph');
                      }}
                    >
                      この{tab === 'industry' ? '産業' : '貨物'}から表示
                      <ArrowRight size={17} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <GitFork size={37} strokeWidth={1.25} />
                  <h2>探索の起点を選択</h2>
                  <p>
                    左の一覧から選ぶと、
                    <br />
                    入出力と読み込み元を確認できます。
                  </p>
                </div>
              )}
            </section>
          </div>
        </main>
      )}

      {screen === 'graph' && graph && root && (
        <div className="graph-page">
          <div className="graph-toolbar">
            <button className="text-button" onClick={() => setScreen('select')}>
              <ArrowLeft size={17} />
              起点変更
            </button>
            <div className="graph-title">
              <strong>{lookup(graph, root)?.display_name}</strong>
              <span>上流・下流の産業と貨物</span>
            </div>
            <div className="legend">
              <span>
                <i className="industry-dot" />
                産業
              </span>
              <span>
                <i className="goods-dot" />
                貨物
              </span>
            </div>
            <button className="secondary" onClick={() => setScreen('sources')}>
              <FolderOpen size={16} />
              読み込み設定
            </button>
          </div>
          <GraphView
            previews={report.previews}
            key={root + loadedSources.join('|')}
            graph={graph}
            root={root}
            onRootChange={setRoot}
          />
        </div>
      )}

      <footer className="app-footer">
        <span>SIMUTRANS FACTORY GRAPH</span>
        <span>
          {report
            ? `${Object.keys(report.data.industries).length} 産業 · ${Object.keys(report.data.goods).length} 貨物${report.incomplete ? ' · 部分的な解析結果' : ''}`
            : 'PAKの産業・貨物を可視化する独立した補助ツール'}
        </span>
      </footer>
    </div>
  );
}
