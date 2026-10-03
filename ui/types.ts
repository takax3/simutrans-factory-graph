export interface SourceRef {
  directory: string;
  file: string;
  object_index: number;
}
export interface BaseObject {
  id: string;
  internal_name: string;
  display_name: string;
  source: SourceRef | null;
  overridden: SourceRef[];
}
export interface Industry extends BaseObject {
  inputs: string[];
  outputs: string[];
}
export interface Goods extends BaseObject {
  producers: string[];
  consumers: string[];
  unresolved: boolean;
}
export interface IndustryGraph {
  industries: Record<string, Industry>;
  goods: Record<string, Goods>;
}
export interface Diagnostic {
  severity: string;
  code: string;
  message: string;
  source: SourceRef | null;
  object_id: string | null;
}
export interface LoadReport {
  previews?: Record<string, PreviewImage>;
  data: IndustryGraph;
  diagnostics: Diagnostic[];
  files_loaded: number;
  files_failed: number;
  incomplete: boolean;
}
export interface Progress {
  stage?: 'pak' | 'images';
  completed: number;
  total: number;
  file: string;
}
export interface PreviewImage {
  data_url: string;
  width: number;
  height: number;
}
