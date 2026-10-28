/**
 * Persistent document storage layer.
 * Documents are stored locally (like images) and sync with backend.
 * Local storage acts as cache to prevent UI disappearing.
 * 
 * This is the SOURCE OF TRUTH for document list.
 */

import type { HeliumDocument } from "@/lib/api";

const STORAGE_KEY = "helium_documents_v1";

interface StoredDocument extends HeliumDocument {
  syncedAt: string; // ISO timestamp of last backend sync
  uploadedLocally: boolean; // whether document was added locally before backend confirmation
}

class DocumentStore {
  private docs: Map<string, StoredDocument> = new Map();
  private listeners: Set<() => void> = new Set();
  private initialized = false;

  constructor() {
    // Don't load from storage in constructor (runs at build time)
    // Initialize lazily on first access
  }

  private ensureInitialized(): void {
    if (!this.initialized && typeof window !== "undefined") {
      this.loadFromStorage();
      this.initialized = true;
    }
  }

  /**
   * Subscribe to document changes
   */
  subscribe(listener: () => void): () => void {
    this.ensureInitialized();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of changes
   */
  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Load documents from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const docs = JSON.parse(stored) as StoredDocument[];
        this.docs = new Map(docs.map((d) => [d.id, d]));
      }
    } catch (err) {
      console.warn("[DocumentStore] Failed to load from storage:", err);
      this.docs.clear();
    }
  }

  /**
   * Save documents to localStorage
   */
  private saveToStorage(): void {
    try {
      const docs = Array.from(this.docs.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
    } catch (err) {
      console.warn("[DocumentStore] Failed to save to storage:", err);
    }
  }

  /**
   * Sync documents with backend response
   * Merges local and backend data WITHOUT deleting local docs
   * 
   * Strategy: Local documents are NEVER deleted by sync. They persist until:
   * 1. Explicitly deleted by user via API call
   * 2. User clears workspace
   * 3. User logs out (localStorage cleared)
   * 
   * This prevents documents from disappearing due to API delays or errors.
   */
  syncWithBackend(backendDocs: HeliumDocument[]): void {
    this.ensureInitialized();
    const backendMap = new Map(backendDocs.map((d) => [d.id, d]));
    const now = new Date().toISOString();
    let changed = false;

    // Update existing documents with backend data (merge status/progress)
    for (const [id, doc] of this.docs.entries()) {
      if (backendMap.has(id)) {
        // Update from backend: status, chunks, embeddings etc
        const backendDoc = backendMap.get(id)!;
        const updated: StoredDocument = {
          ...doc,
          ...backendDoc,
          syncedAt: now,
        };
        this.docs.set(id, updated);
        backendMap.delete(id);
        changed = true;
      }
      // If NOT in backend response, KEEP local document (don't delete)
      // This preserves documents during:
      // - API delays (backend processing slowly)
      // - API errors (listDocuments timeout)
      // - Partial responses (backend returns some docs but not all)
    }

    // Add new documents from backend (uploaded elsewhere / other devices)
    for (const [_id, backendDoc] of backendMap.entries()) {
      this.docs.set(backendDoc.id, {
        ...backendDoc,
        syncedAt: now,
        uploadedLocally: false,
      });
      changed = true;
    }

    if (changed) {
      this.saveToStorage();
      this.notify();
    }
  }

  /**
   * Add locally uploaded document (before backend confirmation)
   * This appears immediately in the UI
   */
  addLocal(doc: HeliumDocument): void {
    this.ensureInitialized();
    const stored: StoredDocument = {
      ...doc,
      syncedAt: new Date().toISOString(),
      uploadedLocally: true,
    };
    this.docs.set(doc.id, stored);
    this.saveToStorage();
    this.notify();
  }

  /**
   * Get all documents (this is what UI should render)
   */
  getAll(): StoredDocument[] {
    this.ensureInitialized();
    return Array.from(this.docs.values()).sort(
      (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
    );
  }

  /**
   * Get document by id
   */
  get(id: string): StoredDocument | undefined {
    this.ensureInitialized();
    return this.docs.get(id);
  }

  /**
   * Remove document (called when backend deletes it)
   */
  remove(id: string): void {
    this.ensureInitialized();
    this.docs.delete(id);
    this.saveToStorage();
    this.notify();
  }

  /**
   * Update single document
   */
  update(id: string, updates: Partial<HeliumDocument>): void {
    this.ensureInitialized();
    const doc = this.docs.get(id);
    if (doc) {
      this.docs.set(id, {
        ...doc,
        ...updates,
        syncedAt: new Date().toISOString(),
      });
      this.saveToStorage();
      this.notify();
    }
  }

  /**
   * Clear all documents (when user resets workspace)
   */
  clear(): void {
    this.ensureInitialized();
    this.docs.clear();
    this.saveToStorage();
    this.notify();
  }

  /**
   * Get count of documents in each status
   */
  getStats() {
    this.ensureInitialized();
    let ready = 0;
    let processing = 0;
    let failed = 0;

    for (const doc of this.docs.values()) {
      if (doc.status === "ready") ready++;
      else if (doc.status === "processing" || doc.status === "queued") processing++;
      else if (doc.status === "failed") failed++;
    }

    return { ready, processing, failed, total: this.docs.size };
  }
}

/**
 * Singleton document store
 * This is the SOURCE OF TRUTH for document list
 * 
 * Usage:
 * - documentStore.getAll() - get all documents (render this)
 * - documentStore.addLocal(doc) - add locally uploaded doc
 * - documentStore.syncWithBackend(docs) - merge backend response
 * - documentStore.subscribe(listener) - listen for changes
 */
export const documentStore = new DocumentStore();
