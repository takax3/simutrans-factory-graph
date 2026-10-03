import { describe, expect, it } from 'vitest';
import {
  dependencies,
  initialExpanded,
  searchObjects,
  toggleExpansion,
  visibleTree,
} from './exploration';
import { goods, industry, testGraph } from './fixtures';

describe('upstream exploration', () => {
  it('initially opens only one level and works from goods', () => {
    const graph = testGraph();
    const nodes = visibleTree(graph, 'industry:store', initialExpanded(graph, 'industry:store'));
    expect(nodes.map((n) => n.objectId)).toEqual(['industry:store', 'goods:food', 'goods:milk']);
    expect(dependencies(graph, 'goods:grain')).toEqual(['industry:farm']);
    expect(visibleTree(graph, 'goods:grain', new Set(['root']))).toHaveLength(2);
    expect(visibleTree(graph, 'industry:missing', new Set())).toEqual([]);
  });
  it('duplicates shared objects per path and collapses only that branch', () => {
    const graph = testGraph();
    let expanded = new Set(['root', 'root/0', 'root/1', 'root/0/0', 'root/1/0']);
    let nodes = visibleTree(graph, 'industry:store', expanded);
    expect(nodes.filter((n) => n.objectId === 'industry:plant')).toHaveLength(2);
    expect(
      nodes.filter((n) => n.objectId === 'industry:plant').every((n) => n.shared && !n.cycle),
    ).toBe(true);
    expanded = toggleExpansion(
      graph,
      'industry:store',
      expanded,
      nodes.find((n) => n.id === 'root/0')!,
    );
    nodes = visibleTree(graph, 'industry:store', expanded);
    expect(nodes.some((n) => n.id === 'root/0/0')).toBe(false);
    expect(nodes.some((n) => n.id === 'root/1/0/0')).toBe(true);
    expect(expanded.has('root/0/0')).toBe(false);
  });
  it('stops self cycles and multi-industry cycles on the ancestor path', () => {
    const graph = testGraph();
    graph.goods['goods:food'].producers = ['industry:store'];
    let expanded = new Set(['root', 'root/0', 'root/0/0']);
    const cycle = visibleTree(graph, 'industry:store', expanded).find((n) => n.id === 'root/0/0')!;
    expect(cycle.cycle).toBe(true);
    expect(toggleExpansion(graph, 'industry:store', expanded, cycle)).toEqual(expanded);
    graph.goods['goods:food'].producers = ['industry:plant'];
    graph.goods['goods:grain'].producers = ['industry:store'];
    expanded = new Set(['root', 'root/0', 'root/0/0', 'root/0/0/0', 'root/0/0/0/0']);
    expect(
      visibleTree(graph, 'industry:store', expanded).find((n) => n.id === 'root/0/0/0/0')?.cycle,
    ).toBe(true);
  });
  it('refuses an entire expansion beyond 1000, and can expand after collapse', () => {
    const graph = testGraph();
    for (let i = 0; i < 997; i++) graph.industries[`industry:p${i}`] = industry(`p${i}`);
    graph.goods['goods:food'] = goods(
      'food',
      Array.from({ length: 997 }, (_, i) => `p${i}`),
    );
    let expanded = new Set(['root', 'root/0']);
    let nodes = visibleTree(graph, 'industry:store', expanded);
    expect(nodes).toHaveLength(1000);
    const milk = nodes.find((n) => n.objectId === 'goods:milk')!;
    expect(() => toggleExpansion(graph, 'industry:store', expanded, milk)).toThrow('1,000');
    expect(expanded.has(milk.id)).toBe(false);
    expanded = toggleExpansion(
      graph,
      'industry:store',
      expanded,
      nodes.find((n) => n.objectId === 'goods:food')!,
    );
    expect(() => toggleExpansion(graph, 'industry:store', expanded, milk)).not.toThrow();
  });
  it('handles roots exceeding the initial display limit', () => {
    const graph = testGraph();
    graph.goods['goods:food'].producers = Array.from({ length: 1000 }, (_, i) => `industry:${i}`);
    expect(initialExpanded(graph, 'goods:food').size).toBe(0);
  });
  it('searches both names and normalizes full-width letters', () => {
    const objects = Object.values(testGraph().industries);
    expect(searchObjects(objects, '食品')[0].internal_name).toBe('plant');
    expect(searchObjects(objects, 'ＰＬＡＮＴ')[0].display_name).toBe('食品工場');
    expect(searchObjects(objects, 'unknown')).toEqual([]);
  });
});
