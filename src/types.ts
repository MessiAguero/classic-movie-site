export interface Rating {
  source: string;
  value: string;
  sub?: string;
}

export interface Highlight {
  ic?: string;
  title: string;
  body: string;
}

export interface Quote {
  text: string;
  who?: string;
}

export interface WhyItem {
  no?: string;
  title?: string;
  body: string;
}

export interface ArchiveRow {
  k: string;
  v: string;
}

export interface Movie {
  id: string;            // YYYYMMDD 或 YYYYMMDD-2
  date: string;          // YYYYMMDD
  zhTitle: string;
  enTitle?: string;
  year?: string;
  tagline?: string;
  meta?: string;
  ratings: Rating[];
  plot: string[];
  spoilerNote?: string;
  highlights: Highlight[];
  quotes: Quote[];
  why: WhyItem[];
  honors: string[];
  archive: ArchiveRow[];
  review?: string;
  reviewBy?: string;
  reviewStars?: number;
  posterSvg?: string;
  posterCaption?: string;
  status?: 'published' | 'draft';
}
