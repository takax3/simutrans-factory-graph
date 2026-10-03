import type { BaseObject, IndustryGraph } from './types';

export const NODE_LIMIT = 1000;
export type Direction = 'upstream' | 'downstream';
export interface Occurrence {
  id: string;
  objectId: string;
  parentId?: string;
  direction?: Direction;
  ancestors: string[];
  cycle: boolean;
  shared: boolean;
}
export function expansionDirections(node: Pick<Occurrence, 'direction'>): readonly Direction[] {
  return node.direction ? [node.direction] : ['upstream', 'downstream'];
}
export function lookup(graph: IndustryGraph, id: string): BaseObject | undefined {
  return graph.industries[id] ?? graph.goods[id];
}
export function dependencies(
  graph: IndustryGraph,
  id: string,
  direction: Direction = 'upstream',
): string[] {
  if (direction === 'downstream')
    return graph.industries[id]?.outputs ?? graph.goods[id]?.consumers ?? [];
  return graph.industries[id]?.inputs ?? graph.goods[id]?.producers ?? [];
}

export function visibleTree(
  graph: IndustryGraph,
  root: string,
  expanded: ReadonlySet<string>,
  limit = NODE_LIMIT,
): Occurrence[] {
  if (!lookup(graph, root)) return [];
  const nodes: Occurrence[] = [];
  const queue: Occurrence[] = [
    { id: 'root', objectId: root, ancestors: [], cycle: false, shared: false },
  ];
  const counts = new Map<string, number>();
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    nodes.push(current);
    counts.set(current.objectId, (counts.get(current.objectId) ?? 0) + 1);
    for (const direction of expansionDirections(current)) {
      if (!current.cycle && expanded.has(expansionKey(current.id, direction))) {
        const ancestors = [...current.ancestors, current.objectId];
        dependencies(graph, current.objectId, direction).forEach((objectId, child) => {
          if (queue.length >= limit)
            throw new Error(
              `表示上限は${limit.toLocaleString()}ノードです。他の枝を折り畳んでから展開してください。`,
            );
          queue.push({
            id: `${current.id}/${direction === 'upstream' ? 'u' : 'd'}${child}`,
            direction,
            objectId,
            parentId: current.id,
            ancestors,
            cycle: ancestors.includes(objectId),
            shared: false,
          });
        });
      }
    }
  }
  return nodes.map((node) => ({ ...node, shared: (counts.get(node.objectId) ?? 0) > 1 }));
}

export function expansionKey(id: string, direction: Direction): string {
  return id + ':' + direction;
}
export function initialExpanded(graph: IndustryGraph, root: string): Set<string> {
  const expanded = new Set<string>();
  let count = 1;
  for (const direction of ['upstream', 'downstream'] as const) {
    const children = dependencies(graph, root, direction).length;
    if (count + children <= NODE_LIMIT) {
      expanded.add(expansionKey('root', direction));
      count += children;
    }
  }
  return expanded;
}

export function toggleExpansion(
  graph: IndustryGraph,
  root: string,
  expanded: ReadonlySet<string>,
  node: Occurrence,
  direction: Direction = 'upstream',
): Set<string> {
  const next = new Set(expanded);
  if (
    !expansionDirections(node).includes(direction) ||
    node.cycle ||
    !dependencies(graph, node.objectId, direction).length
  )
    return next;
  const key = expansionKey(node.id, direction);
  if (next.has(key)) {
    next.delete(key);
    const prefix = node.id + '/' + (direction === 'upstream' ? 'u' : 'd');
    for (const id of next) if (id.startsWith(prefix)) next.delete(id);
  } else next.add(key);
  visibleTree(graph, root, next);
  return next;
}

export function searchObjects<T extends BaseObject>(objects: T[], query: string): T[] {
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase('ja');
  return objects
    .filter((o) =>
      [o.display_name, o.internal_name].some((n) =>
        n.normalize('NFKC').toLocaleLowerCase('ja').includes(needle),
      ),
    )
    .sort(
      (a, b) =>
        a.display_name.localeCompare(b.display_name, 'ja') ||
        a.internal_name.localeCompare(b.internal_name),
    );
}
