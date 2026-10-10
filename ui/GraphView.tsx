import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps,
  type Edge,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import {
  Box,
  Copy,
  Factory,
  LocateFixed,
  Minus,
  Plus,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import '@xyflow/react/dist/style.css';
import type { IndustryGraph, PreviewImage } from './types';
import IndustryImage from './IndustryImage';
import { categoryLabel, categoryLines } from './categories';
import {
  dependencies,
  expansionDirections,
  expansionKey,
  initialExpanded,
  lookup,
  NODE_LIMIT,
  toggleExpansion,
  visibleTree,
  type Occurrence,
  type Direction,
} from './exploration';

type GraphNode = Node<{
  label: string;
  image?: PreviewImage;
  internalName: string;
  category: string[];
  industry: boolean;
  cycle: boolean;
  shared: boolean;
  unresolved: boolean;
  root: boolean;
  directions: readonly Direction[];
  expanded: Record<Direction, boolean>;
  childCount: Record<Direction, number>;
  toggle: (direction: Direction) => void;
  changeRoot: () => void;
  filterBranch?: () => void;
  filtered: boolean;
  height: number;
}>;

function EntityNode({ data }: NodeProps<GraphNode>) {
  const [copyStatus, setCopyStatus] = useState('');
  const copyName = async (text: string, kind: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(kind + 'をコピーしました');
    } catch {
      setCopyStatus('コピーできませんでした。もう一度お試しください');
    }
  };
  const control = (direction: Direction) => {
    const upstream = direction === 'upstream';
    const label = upstream
      ? data.industry
        ? '要求貨物'
        : '生産産業'
      : data.industry
        ? '生産貨物'
        : '消費産業';
    return (
      <div className={'entity-direction ' + (upstream ? 'entity-upstream' : 'entity-downstream')}>
        <button
          className="nodrag"
          onClick={() => data.toggle(direction)}
          disabled={data.cycle || !data.childCount[direction]}
          aria-label={
            data.label +
            'の' +
            (upstream ? '上流' : '下流') +
            'を' +
            (data.expanded[direction] ? '折り畳む' : '展開')
          }
          aria-expanded={data.expanded[direction]}
        >
          {data.expanded[direction] ? <Minus size={13} /> : <Plus size={13} />}
          {upstream ? '← ' : '→ '}
          {label} {data.childCount[direction]} 件
        </button>
      </div>
    );
  };
  return (
    <div
      style={{ height: data.height }}
      className={
        'entity-node ' +
        (data.industry ? 'industry-node' : 'goods-node') +
        (data.cycle ? ' cycle-node' : '') +
        (data.root ? ' root-node' : '')
      }
    >
      <Handle id="left-target" type="target" position={Position.Left} isConnectable={false} />
      <Handle id="left-source" type="source" position={Position.Left} isConnectable={false} />
      <div className="entity-main">
        <span className="entity-kind">
          {data.industry ? <Factory size={16} /> : <Box size={16} />}
          {data.industry ? '産業' : '貨物'}
          {data.root && <span className="root-label">起点</span>}
          {data.shared && <span className="shared-label">共有</span>}
          <button
            className="node-root-button nodrag nopan"
            onClick={data.changeRoot}
            disabled={data.root}
            aria-label={`${data.label}を起点にする`}
            title={data.root ? '現在の起点です' : 'このノードを起点にして表示し直す'}
          >
            <LocateFixed size={12} />
            {data.root ? '現在の起点' : '起点にする'}
          </button>
        </span>
        {data.filterBranch && (
          <div className="node-filter-row">
            <button
              className="node-root-button nodrag nopan"
              onClick={data.filterBranch}
              aria-label={`${data.label}の${data.filtered ? '絞り込みを解除' : '枝に絞る'}`}
              aria-pressed={data.filtered}
            >
              {data.filtered ? '絞り込みを解除' : 'この産業に絞る'}
            </button>
          </div>
        )}
        <div className="node-name-row">
          <button
            className="node-copy-button nodrag nopan"
            onClick={() => void copyName(data.label, '表示名')}
            aria-label={`${data.label}の表示名をコピー`}
            title="表示名をコピー"
          >
            <Copy size={12} />
          </button>
          <strong title={data.label}>{data.label}</strong>
        </div>
        <div className="node-name-row internal-name-row">
          <button
            className="node-copy-button nodrag nopan"
            onClick={() => void copyName(data.internalName, '内部名')}
            aria-label={`${data.internalName}の内部名をコピー`}
            title="内部名をコピー"
          >
            <Copy size={12} />
          </button>
          <small title={data.internalName}>{data.internalName}</small>
        </div>
        {!data.industry && (
          <div className="node-category">
            {data.category.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </div>
        )}
        <span className="copy-status" role="status">
          {copyStatus}
        </span>
        {data.industry && <IndustryImage image={data.image} name={data.label} />}
        {data.cycle && (
          <span className="node-status">
            <RotateCcw size={13} />
            循環参照・展開停止
          </span>
        )}
        {data.unresolved && (
          <span className="node-status">
            <TriangleAlert size={13} />
            定義なし
          </span>
        )}
      </div>
      <div className="entity-bottom">
        {data.directions.includes('upstream') && control('upstream')}
        {data.directions.includes('downstream') && control('downstream')}
      </div>
      <Handle id="right-target" type="target" position={Position.Right} isConnectable={false} />
      <Handle id="right-source" type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
const nodeTypes = { entity: EntityNode };
const WIDTH = 242;
function canFilterBranch(graph: IndustryGraph, node: Occurrence, occurrences: Occurrence[]) {
  const parent = occurrences.find((p) => p.id === node.parentId);
  return (
    !!parent &&
    !!node.direction &&
    !!graph.industries[node.objectId] &&
    !!graph.goods[parent.objectId] &&
    dependencies(graph, parent.objectId, node.direction).length > 1
  );
}
function nodeHeight(graph: IndustryGraph, node: Occurrence, occurrences: Occurrence[]) {
  return (
    (graph.industries[node.objectId]
      ? 195
      : 132 + categoryLines(categoryLabel(graph.goods[node.objectId])).length * 16) +
    (canFilterBranch(graph, node, occurrences) ? 24 : 0) +
    (node.cycle ? 20 : 0) +
    (graph.goods[node.objectId]?.unresolved ? 20 : 0) +
    (node.id === 'root' ? 4 : 0)
  );
}

function layout(occurrences: Occurrence[], graph: IndustryGraph) {
  const model = new dagre.graphlib.Graph();
  model.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 45, marginx: 40, marginy: 40 });
  model.setDefaultEdgeLabel(() => ({}));
  occurrences.forEach((n) =>
    model.setNode(n.id, { width: WIDTH, height: nodeHeight(graph, n, occurrences) }),
  );
  occurrences.forEach((n) => {
    if (n.parentId) {
      if (n.direction === 'upstream') model.setEdge(n.id, n.parentId);
      else model.setEdge(n.parentId, n.id);
    }
  });
  dagre.layout(model);
  return new Map(
    occurrences.map((n) => {
      const position = model.node(n.id);
      return [
        n.id,
        { x: position.x - WIDTH / 2, y: position.y - nodeHeight(graph, n, occurrences) / 2 },
      ];
    }),
  );
}

interface GraphViewProps {
  previews?: Record<string, PreviewImage>;
  graph: IndustryGraph;
  root: string;
  onRootChange: (objectId: string) => void;
}

function Explorer({ graph, root, onRootChange, previews }: GraphViewProps) {
  const [expanded, setExpanded] = useState(() => initialExpanded(graph, root));
  const [choices, setChoices] = useState<Map<string, string>>(() => new Map());
  const [message, setMessage] = useState(() =>
    dependencies(graph, root).length + dependencies(graph, root, 'downstream').length >= NODE_LIMIT
      ? '起点の関係先が表示上限を超えるため、一部の方向を折り畳んでいます。'
      : '',
  );
  const flow = useReactFlow<GraphNode>();
  const occurrences = useMemo(
    () => visibleTree(graph, root, expanded, NODE_LIMIT, choices),
    [graph, root, expanded, choices],
  );
  const positions = useMemo(() => layout(occurrences, graph), [occurrences, graph]);
  const toggle = useCallback(
    (node: Occurrence, direction: Direction) => {
      try {
        const next = toggleExpansion(graph, root, expanded, node, direction, choices);
        const nextPositions = layout(visibleTree(graph, root, next, NODE_LIMIT, choices), graph);
        const before = positions.get(node.id),
          after = nextPositions.get(node.id);
        const viewport = flow.getViewport();
        setExpanded(next);
        setMessage('');
        if (before && after)
          void flow.setViewport({
            ...viewport,
            x: viewport.x + (before.x - after.x) * viewport.zoom,
            y: viewport.y + (before.y - after.y) * viewport.zoom,
          });
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [graph, root, expanded, positions, flow, choices],
  );
  const filterBranch = (node: Occurrence) => {
    const key = expansionKey(node.parentId!, node.direction!);
    const next = new Map(choices);
    if (next.get(key) === node.objectId) next.delete(key);
    else next.set(key, node.objectId);
    try {
      const nextPositions = layout(visibleTree(graph, root, expanded, NODE_LIMIT, next), graph);
      const before = positions.get(node.id),
        after = nextPositions.get(node.id);
      const viewport = flow.getViewport();
      setChoices(next);
      setMessage('');
      if (before && after)
        void flow.setViewport({
          ...viewport,
          x: viewport.x + (before.x - after.x) * viewport.zoom,
          y: viewport.y + (before.y - after.y) * viewport.zoom,
        });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const nodes: GraphNode[] = occurrences.map((n) => {
    const object = lookup(graph, n.objectId)!;
    const parent = occurrences.find((p) => p.id === n.parentId);
    const canFilter = canFilterBranch(graph, n, occurrences);
    return {
      id: n.id,
      type: 'entity',
      position: positions.get(n.id)!,
      data: {
        height: nodeHeight(graph, n, occurrences),
        label: object.display_name,
        image: previews?.[n.objectId],
        internalName: object.internal_name,
        category: graph.goods[n.objectId]
          ? categoryLines(categoryLabel(graph.goods[n.objectId]))
          : [],
        industry: !!graph.industries[n.objectId],
        cycle: n.cycle,
        shared: n.shared,
        unresolved: graph.goods[n.objectId]?.unresolved ?? false,
        root: n.id === 'root',
        directions: expansionDirections(n),
        expanded: {
          upstream: expanded.has(expansionKey(n.id, 'upstream')),
          downstream: expanded.has(expansionKey(n.id, 'downstream')),
        },
        childCount: {
          upstream: dependencies(graph, n.objectId).length,
          downstream: dependencies(graph, n.objectId, 'downstream').length,
        },
        toggle: (direction) => toggle(n, direction),
        changeRoot: () => onRootChange(n.objectId),
        filtered:
          !!parent &&
          !!n.direction &&
          choices.get(expansionKey(parent.id, n.direction)) === n.objectId,
        filterBranch: canFilter ? () => filterBranch(n) : undefined,
      },
    };
  });
  const edges: Edge[] = occurrences
    .filter((n) => n.parentId)
    .map((n) => ({
      id: `edge:${n.id}`,
      source: n.parentId!,
      target: n.id,
      sourceHandle: n.direction === 'upstream' ? 'left-source' : 'right-source',
      targetHandle: n.direction === 'upstream' ? 'right-target' : 'left-target',
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#a9b7c9', width: 15, height: 15 },
      style: { stroke: '#a9b7c9', strokeWidth: 1.5 },
    }));
  return (
    <div className="graph-canvas">
      <div className="graph-surface">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
          minZoom={0.05}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          onlyRenderVisibleElements
          ariaLabelConfig={{
            'controls.zoomIn.ariaLabel': '拡大',
            'controls.zoomOut.ariaLabel': '縮小',
            'controls.fitView.ariaLabel': '表示中のノードを全体表示',
          }}
        >
          <Background gap={24} size={1} color="#d6dfe9" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="canvas-top">
        <span>左側で上流へ、右側で下流へ展開</span>
        <button
          className="secondary"
          onClick={() => {
            const p = positions.get('root');
            if (p)
              void flow.setCenter(
                p.x + WIDTH / 2,
                p.y + nodeHeight(graph, occurrences[0], occurrences) / 2,
                {
                  zoom: 1,
                  duration: 250,
                },
              );
          }}
        >
          <LocateFixed size={16} />
          起点へ戻る
        </button>
      </div>
      {message && (
        <div className="graph-message" role="alert">
          <TriangleAlert size={16} />
          {message}
          <button aria-label="通知を閉じる" onClick={() => setMessage('')}>
            ×
          </button>
        </div>
      )}
      <div className="canvas-caption">
        {occurrences.length.toLocaleString()} / {NODE_LIMIT.toLocaleString()} ノード
        <span>線はクリックした方向へ関係を辿ります</span>
      </div>
    </div>
  );
}
export default function GraphView(props: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <Explorer {...props} />
    </ReactFlowProvider>
  );
}
