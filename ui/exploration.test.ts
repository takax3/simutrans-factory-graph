import { describe, expect, it } from 'vitest';
import {
  dependencies,
  initialExpanded,
  searchObjects,
  toggleExpansion,
  visibleTree,
  expansionKey,
} from './exploration';
import { goods, industry, testGraph } from './fixtures';
const open = (...keys: string[]) => new Set(keys);
describe('bidirectional exploration', () => {
  it('initially opens one level on both sides, from industry and goods', () => {
    const graph = testGraph();
    expect(
      visibleTree(graph, 'industry:plant', initialExpanded(graph, 'industry:plant')).map(
        (n) => n.objectId,
      ),
    ).toEqual(['industry:plant', 'goods:grain', 'goods:food', 'goods:milk']);
    expect(
      visibleTree(graph, 'goods:grain', initialExpanded(graph, 'goods:grain')).map(
        (n) => n.objectId,
      ),
    ).toEqual(['goods:grain', 'industry:farm', 'industry:plant']);
    expect(dependencies(graph, 'goods:grain')).toEqual(['industry:farm']);
    expect(dependencies(graph, 'goods:grain', 'downstream')).toEqual(['industry:plant']);
    expect(visibleTree(graph, 'industry:missing', new Set())).toEqual([]);
  });
  it('collapses only the chosen direction and its descendants', () => {
    const graph = testGraph();
    let expanded = open(
      'root:upstream',
      'root:downstream',
      'root/u0:upstream',
      'root/d0:downstream',
      'root/d1:downstream',
    );
    let nodes = visibleTree(graph, 'industry:plant', expanded);
    expect(nodes.filter((n) => n.objectId === 'industry:store')).toHaveLength(2);
    expect(
      nodes.filter((n) => n.objectId === 'industry:store').every((n) => n.shared && !n.cycle),
    ).toBe(true);
    expanded = toggleExpansion(graph, 'industry:plant', expanded, nodes[0], 'upstream');
    nodes = visibleTree(graph, 'industry:plant', expanded);
    expect(nodes.some((n) => n.id.startsWith('root/u'))).toBe(false);
    expect(nodes.some((n) => n.id === 'root/d0/d0')).toBe(true);
    expect(expanded.has('root/u0:upstream')).toBe(false);
    expanded = toggleExpansion(
      graph,
      'industry:plant',
      expanded,
      nodes.find((n) => n.id === 'root/d0')!,
      'downstream',
    );
    expect(visibleTree(graph, 'industry:plant', expanded).some((n) => n.id === 'root/d1/d0')).toBe(
      true,
    );
  });
  it('can expand either direction on a non-root node and stops ancestor cycles', () => {
    const graph = testGraph();
    let expanded = initialExpanded(graph, 'industry:plant');
    let nodes = visibleTree(graph, 'industry:plant', expanded);
    const grain = nodes.find((n) => n.id === 'root/u0')!;
    expanded = toggleExpansion(graph, 'industry:plant', expanded, grain, 'upstream');
    expanded = toggleExpansion(graph, 'industry:plant', expanded, grain, 'downstream');
    nodes = visibleTree(graph, 'industry:plant', expanded);
    expect(nodes.find((n) => n.id === 'root/u0/u0')?.objectId).toBe('industry:farm');
    const cycle = nodes.find((n) => n.id === 'root/u0/d0')!;
    expect(cycle.cycle).toBe(true);
    expect(toggleExpansion(graph, 'industry:plant', expanded, cycle, 'downstream')).toEqual(
      expanded,
    );
    expanded = toggleExpansion(graph, 'industry:plant', expanded, grain, 'upstream');
    expect(visibleTree(graph, 'industry:plant', expanded).some((n) => n.id === 'root/u0/d0')).toBe(
      true,
    );
  });
  it('stops multi-industry cycles downstream', () => {
    const graph = testGraph();
    graph.industries['industry:store'].outputs = ['goods:grain'];
    const nodes = visibleTree(
      graph,
      'industry:plant',
      open(
        'root:downstream',
        'root/d0:downstream',
        'root/d0/d0:downstream',
        'root/d0/d0/d0:downstream',
      ),
    );
    expect(nodes.find((n) => n.id === 'root/d0/d0/d0/d0')?.cycle).toBe(true);
  });
  it('enforces a combined limit, leaves state unchanged on failure, and permits expansion after collapse', () => {
    const graph = testGraph();
    for (let i = 0; i < 997; i++) graph.industries[`industry:p${i}`] = industry(`p${i}`);
    graph.goods['goods:food'] = goods(
      'food',
      Array.from({ length: 997 }, (_, i) => `p${i}`),
      ['store'],
    );
    let expanded = open('root:upstream', 'root/u0:upstream');
    let nodes = visibleTree(graph, 'industry:store', expanded);
    expect(nodes).toHaveLength(1000);
    const milk = nodes.find((n) => n.objectId === 'goods:milk')!;
    expect(() => toggleExpansion(graph, 'industry:store', expanded, milk, 'downstream')).toThrow(
      '1,000',
    );
    expect(expanded.has(expansionKey(milk.id, 'downstream'))).toBe(false);
    expanded = toggleExpansion(
      graph,
      'industry:store',
      expanded,
      nodes.find((n) => n.id === 'root/u0')!,
      'upstream',
    );
    expect(() =>
      toggleExpansion(graph, 'industry:store', expanded, milk, 'downstream'),
    ).not.toThrow();
  });
  it('keeps oversized initial roots within the combined limit', () => {
    const graph = testGraph();
    graph.goods['goods:food'].producers = Array.from({ length: 1000 }, (_, i) => `industry:${i}`);
    expect(initialExpanded(graph, 'goods:food').has('root:upstream')).toBe(false);
    expect(visibleTree(graph, 'goods:food', initialExpanded(graph, 'goods:food'))).toHaveLength(2);
  });
  it('searches both names and normalizes full-width letters', () => {
    const objects = Object.values(testGraph().industries);
    expect(searchObjects(objects, 'ＰＬＡＮＴ')[0].display_name).toBe('食品工場');
    expect(searchObjects(objects, 'unknown')).toEqual([]);
  });
});
