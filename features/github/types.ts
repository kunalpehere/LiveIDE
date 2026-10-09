export type Repository = { id: number; owner: string; name: string; private: boolean; description: string | null; defaultBranch: string | null };
export type Branch = { name: string; protected: boolean };
export type TreeEntry = { name: string; path: string; kind: "directory" | "file" | "unsupported"; size: number | null; restriction: string | null; cursor: string | null };
export type Page<T> = { items: T[]; page: number; hasNext: boolean };
export type Directory = Page<TreeEntry> & { path: string; branch: string; cursor: string; treeSha: string };
export type FilePreview = { path: string; branch: string; sha: string; size: number; content: string };
export type BrowseFailure = { error: string; code: string; retryAt?: number };
