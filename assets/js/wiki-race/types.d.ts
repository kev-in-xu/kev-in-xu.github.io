export type GameStatus = 'idle' | 'loading_start' | 'running' | 'won' | 'abandoned' | 'error';

export interface WikiPageRef {
  title: string;
  normalizedTitle: string;
  path: string;
  url: string;
  pageId?: number;
}

export interface ValidLinkRef {
  href: string;
  path: string;
  title: string;
  normalizedTitle: string;
  text: string;
}

export interface DailyStartResponse {
  dateKey: string;
  target: WikiPageRef;
  startPage: WikiPageRef;
  seedSource: 'kv' | 'generated';
  generatedAtUtc: string;
  generationAttempts?: number;
}

export interface WikiPagePayload {
  page: WikiPageRef;
  canonicalPath: string;
  displayTitle: string;
  html: string;
  linkIndex: ValidLinkRef[];
  metrics: {
    validOutboundLinkCount: number;
    hasCategories: boolean;
  };
  flags: {
    isDisambiguation: boolean;
    isListLike: boolean;
    isStubLike: boolean;
    isDeadEnd: boolean;
  };
  fetchedAtUtc: string;
  cache: {
    source: 'blob' | 'fresh';
    key?: string;
    revid?: number;
  };
}
