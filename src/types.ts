export type LayerId = 'text' | 'bw_full' | 'detail' | 'color';

export type ShotData = {
  id: string;
  duration_ratio?: number;
  duration_sec?: number;
  shot_size?: 'WIDE' | 'MEDIUM' | 'CLOSE' | 'DETAIL';
  camera_move?: 'static' | 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down' | 'parallax';
  focus?: {x?: number; y?: number; scale?: number};
  element_motion?: string[];
  assets?: Partial<SceneData['assets']>;
};

export type SceneData = {
  id: string;
  duration_sec: number;
  text: string;
  narration?: string;
  visual: string;
  shot: string;
  layers: LayerId[];
  color_hint: string | null;
  detail_hint: string | null;
  caption_box?: {
    top: number;
    height: number;
  } | null;
  assets: {
    text_image?: string | null;
    bw: string | null;
    detail: string | null;
    color: string | null;
  };
  shots?: ShotData[];
};

export type Storyboard = {
  schema_version?: number;
  project: {
    id?: string;
    title: string;
    mode?: 'speed' | 'quality';
    images_per_scene?: number;
    derive_bw?: 'local' | 'ai';
    enable_detail?: boolean;
    gen_size?: number;
    export_size?: [number, number];
    ratio: string;
    width: number;
    height: number;
    fps: number;
    transition?: 'cut' | 'page-flip';
    transition_sec?: number;
    style_lock: string;
    character_lock: string;
    director?: {
      schema_version?: number;
      arc: string;
      theme: string;
      motion_style?: string;
      constraints?: 'strict' | 'loose';
      style_approved?: boolean;
    };
    audio: {
      voiceover: 'post';
      bgm: 'optional_bed_only';
      bgm_follows_text: false;
    };
    caption?: {
      max_chars_per_line: number;
      max_lines: number;
    };
    layout?: {
      caption_top_ratio: number;
      caption_height_ratio: number;
      illustration_top_ratio: number;
      side_margin_ratio: number;
      bottom_margin_ratio: number;
    };
  };
  scenes: SceneData[];
};
