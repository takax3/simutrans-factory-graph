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
import { Box, Factory, LocateFixed, Minus, Plus, RotateCcw, TriangleAlert } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import type { IndustryGraph } from './types';
import {
  dependencies,
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
  internalName: string;
  industry: boolean;
  cycle: boolean;
  shared: boolean;
  unresolved: boolean;
  expanded: boolean;
  childCount: number;
  direction: Direction;
  toggle: () => void;
}>;

function EntityNode({ data }: NodeProps<GraphNode>) {
  return (
    <div
      className={`entity-node ${data.industry ? 'industry-node' : 'goods-node'} ${data.cycle ? 'cycle-node' : ''}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <button
        className="entity-main nodrag"
        onClick={data.toggle}
        disabled={data.cycle || !data.childCount}
        aria-label={`${data.label}を${data.expanded ? '折り畳む' : '展開'}`}
        aria-expanded={data.expanded}
      >
        <span className="entity-kind">
          {data.industry ? <Factory size={16} /> : <Box size={16} />}
          {data.industry ? '産業' : '貨物'}
          {data.shared && <span className="shared-label">共有</span>}
        </span>
        <strong title={data.label}>{data.label}</strong>
        <small title={data.internalName}>{data.internalName}</small>
      </button>
      <div className="entity-bottom">
        {data.cycle ? (
          <span>
            <RotateCcw size={13} />
            循環参照・展開停止
          </span>
        ) : data.unresolved ? (
          <span>
            <TriangleAlert size={13} />
            定義なし
          </span>
        ) : data.childCount ? (
          <button className="nodrag" onClick={data.toggle}>
            {data.expanded ? <Minus size={13} /> : <Plus size={13} />}
            {data.expanded
              ? '折り畳む'
              : `${data.direction === 'downstream' ? (data.industry ? '生産貨物' : '消費産業') : data.industry ? '要求貨物' : '生産産業'} ${data.childCount} 件を展開`}
          </button>
        ) : (
          <span>
            {data.direction === 'downstream'
              ? data.industry
                ? '生産する貨物なし'
                : '消費する産業なし'
              : data.industry
                ? '原料を必要としない産業'
                : '生産する産業なし'}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
const nodeTypes = { entity: EntityNode };
const WIDTH = 242,
  HEIGHT = 136;

function layout(occurrences: Occurrence[]) {
  const model = new dagre.graphlib.Graph();
  model.setGraph({ rankdir: 'TB', nodesep: 30, ranksep: 65, marginx: 40, marginy: 40 });
  model.setDefaultEdgeLabel(() => ({}));
  occurrences.forEach((n) => model.setNode(n.id, { width: WIDTH, height: HEIGHT }));
  occurrences.forEach((n) => {
    if (n.parentId) model.setEdge(n.parentId, n.id);
  });
  dagre.layout(model);
  return new Map(
    occurrences.map((n) => {
      const position = model.node(n.id);
      return [n.id, { x: position.x - WIDTH / 2, y: position.y - HEIGHT / 2 }];
    }),
  );
}

function Explorer({
  graph,
  root,
  direction,
}: {
  graph: IndustryGraph;
  root: string;
  direction: Direction;
}) {
  const [expanded, setExpanded] = useState(() => initialExpanded(graph, root, direction));
  const [message, setMessage] = useState(() =>
    dependencies(graph, root, direction).length >= NODE_LIMIT
      ? '起点の依存先が表示上限を超えるため、起点だけを表示しています。'
      : '',
  );
  const flow = useReactFlow<GraphNode>();
  const occurrences = useMemo(
    () => visibleTree(graph, root, expanded, NODE_LIMIT, direction),
    [graph, root, expanded, direction],
  );
  const positions = useMemo(() => layout(occurrences), [occurrences]);
  const toggle = useCallback(
    (node: Occurrence) => {
      try {
        const next = toggleExpansion(graph, root, expanded, node, direction);
        const nextPositions = layout(visibleTree(graph, root, next, NODE_LIMIT, direction));
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
    [graph, root, expanded, direction, positions, flow],
  );
  const nodes: GraphNode[] = occurrences.map((n) => {
    const object = lookup(graph, n.objectId)!;
    return {
      id: n.id,
      type: 'entity',
      position: positions.get(n.id)!,
      data: {
        label: object.display_name,
        internalName: object.internal_name,
        industry: !!graph.industries[n.objectId],
        cycle: n.cycle,
        shared: n.shared,
        unresolved: graph.goods[n.objectId]?.unresolved ?? false,
        expanded: expanded.has(n.id),
        childCount: dependencies(graph, n.objectId, direction).length,
        direction,
        toggle: () => toggle(n),
      },
    };
  });
  const edges: Edge[] = occurrences
    .filter((n) => n.parentId)
    .map((n) => ({
      id: `edge:${n.id}`,
      source: n.parentId!,
      target: n.id,
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
        <span>クリックして{direction === 'downstream' ? '下流' : '上流'}へ展開</span>
        <button
          className="secondary"
          onClick={() => {
            const p = positions.get('root');
            if (p)
              void flow.setCenter(p.x + WIDTH / 2, p.y + HEIGHT / 2, { zoom: 1, duration: 250 });
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
        <span>
          {direction === 'downstream' ? '線は生産・消費先を辿る方向です' : '線は依存を辿る方向です'}
        </span>
      </div>
    </div>
  );
}
export default function GraphView(props: {
  graph: IndustryGraph;
  root: string;
  direction: Direction;
}) {
  return (
    <ReactFlowProvider>
      <Explorer {...props} />
    </ReactFlowProvider>
  );
}
