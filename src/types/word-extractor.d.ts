declare module 'word-extractor' {
  class WordExtractor {
    extract(path: string): Promise<{
      getBody(): string;
      getFootnotes(): string;
      getEndnotes(): string;
      getHeaders(): string;
    }>;
  }
  export default WordExtractor;
}
