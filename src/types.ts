export interface Clip {
  id: number;
  text: string;
  favorite: boolean;
  created: number;
  kind?: 'text' | 'image';
  origin?: 'clipboard' | 'ai' | 'dictionary';
  width?: number | null;
  height?: number | null;
}
export interface Prompt {
  id: number;
  name: string;
  instructions: string;
  favorite: boolean;
  position: number;
}
export interface Settings {
  base_url: string;
  model: string;
  limit: number;
  shortcut: string;
  paused: boolean;
  autostart: boolean;
  auto_copy: boolean;
  notifications: boolean;
  mappings_path: string;
}
export interface Job {
  id: number;
  input: string;
  prompt_name: string;
  status: string;
  output: string | null;
  error: string | null;
  created: number;
}
export interface Snapshot {
  settings: Settings;
  prompts: Prompt[];
  jobs: Job[];
  queue_paused: boolean;
  has_key: boolean;
  startup_error: string | null;
  last_delivery?: string | null;
}
