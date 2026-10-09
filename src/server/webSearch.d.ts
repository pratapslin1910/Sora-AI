export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export declare function performWebSearch(
  query: string,
  maxResults?: number
): Promise<SearchResult[]>;
