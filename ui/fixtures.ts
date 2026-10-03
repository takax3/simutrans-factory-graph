// Original, minimal test data. No third-party PAK assets are bundled.
import type { Industry, IndustryGraph, Goods, LoadReport } from './types';
const source = { directory: 'C:\\test', file: 'C:\\test\\chain.pak', object_index: 0 };
export function industry(
  name: string,
  inputs: string[] = [],
  outputs: string[] = [],
  display = name,
): Industry {
  return {
    id: `industry:${name}`,
    internal_name: name,
    display_name: display,
    inputs: inputs.map((i) => `goods:${i}`),
    outputs: outputs.map((i) => `goods:${i}`),
    source,
    overridden: [],
  };
}
export function goods(
  name: string,
  producers: string[] = [],
  consumers: string[] = [],
  display = name,
): Goods {
  return {
    id: `goods:${name}`,
    internal_name: name,
    display_name: display,
    producers: producers.map((i) => `industry:${i}`),
    consumers: consumers.map((i) => `industry:${i}`),
    source,
    overridden: [],
    unresolved: false,
  };
}
export function testGraph(): IndustryGraph {
  const industries = [
    industry('store', ['food', 'milk'], [], 'デパート'),
    industry('plant', ['grain'], ['food', 'milk'], '食品工場'),
    industry('farm', [], ['grain'], '農場'),
  ];
  const allGoods = [
    goods('food', ['plant'], ['store'], '食品'),
    goods('milk', ['plant'], ['store'], '牛乳'),
    goods('grain', ['farm'], ['plant'], '小麦'),
  ];
  return {
    industries: Object.fromEntries(industries.map((i) => [i.id, i])),
    goods: Object.fromEntries(allGoods.map((g) => [g.id, g])),
  };
}
export function testReport(): LoadReport {
  return {
    data: testGraph(),
    diagnostics: [],
    files_loaded: 1,
    files_failed: 0,
    incomplete: false,
  };
}
