export type Listener<T> = (payload: T) => void;

/** Küçük, tip güvenli event emitter. */
export class Emitter<Events extends Record<string, unknown>> {
  private map = new Map<keyof Events, Set<Listener<unknown>>>();

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this.map.get(event);
    if (!set) {
      set = new Set();
      this.map.set(event, set);
    }
    set.add(fn as Listener<unknown>);
    return () => this.off(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    this.map.get(event)?.delete(fn as Listener<unknown>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.map.get(event)?.forEach((fn) => (fn as Listener<Events[K]>)(payload));
  }

  clear(): void {
    this.map.clear();
  }
}
