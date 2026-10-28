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

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Subscribe to document changes
   */
  subscribe(listener: () => void): () => void {
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
   * Merges local and backend data
   */
  syncWithBackend(backendDocs: HeliumDocument[]): void {
    const backendMap = new Map(backendDocs.map((d) => [d.id, d]));
    const now = new Date().toISOString();

    // Update existing documents with backend data
    for (const [id, doc] of this.docs.entries()) {
      if (backendMap.has(id)) {
        // Merge: keep local metadata, update processing status
        const backendDoc = backendMap.get(id)!;
        this.docs.set(id, {
          ...doc,
          ...backendDoc,
          syncedAt: now,
        });
        backendMap.delete(id);
      } else {
        // Document was deleted on backend, remove locally
        this.docs.delete(id);
      }
    }

    // Add new documents from backend (uploaded elsewhere)
    for (const [id, backendDoc] of backendMap.entries()) {
      this.docs.set(id, {
        ...backendDoc,
        syncedAt: now,
        uploadedLocally: false,
      });
    }

    this.saveToStorage();
    this.notify();
  }

  /**
   * Add locally uploaded document (before backend confirmation)
   * This appears immediately in the UI
   */
  addLocal(doc: HeliumDocument): void {
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
    return Array.from(this.docs.values()).sort(
      (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
    );
  }

  /**
   * Get document by id
   */
  get(id: string): StoredDocument | undefined {
    return this.docs.get(id);
  }

  /**
   * Remove document (called when backend deletes it)
   */
  remove(id: string): void {
    this.docs.delete(id);
    this.saveToStorage();
    this.notify();
  }

  /**
   * Update single document
   */
  update(id: string, updates: Partial<HeliumDocument>): void {
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
    this.docs.clear();
    this.saveToStorage();
    this.notify();
  }

  /**
   * Get count of documents in each status
   */
  getStats() {
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
