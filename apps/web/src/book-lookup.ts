/** Only an explicit start can issue a lookup; cancellation never queues a retry. */
export class ExplicitBookLookup {
  private generation = 0;
  cancel() { this.generation++; }
  async start<T>(read: () => Promise<T>, accept: (value: T) => void, reject: () => void): Promise<void> {
    const generation = ++this.generation;
    try { const value = await read(); if (generation === this.generation) accept(value); }
    catch { if (generation === this.generation) reject(); }
  }
}
