import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

type Envelope = { version: 1; namespace: string; generation: number; payload: string; checksum: string };

function checksum(value: string): string {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return (result >>> 0).toString(16);
}

/** Two alternating document files keep the last verified snapshot intact during a write. */
export function createDurableStorage(namespace: string, onWarning?: (message: string) => void) {
  const prefix = `hledger-${namespace}`;
  let generation = 0;
  let hydrated = false;
  let tail: Promise<unknown> = Promise.resolve();
  const slotName = (slot: number) => `${prefix}-${slot}.json`;
  async function read(slot: number): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage.getItem(slotName(slot));
    const file = new File(Paths.document, slotName(slot));
    return file.exists ? await file.text() : null;
  }
  async function write(slot: number, content: string): Promise<void> {
    if (Platform.OS === 'web') {
      globalThis.localStorage.setItem(slotName(slot), content);
      return;
    }
    const file = new File(Paths.document, slotName(slot));
    await file.write(content);
  }
  function decode(raw: string): Envelope {
    const value = JSON.parse(raw) as Envelope;
    if (value.version !== 1 || value.namespace !== namespace || !Number.isSafeInteger(value.generation)
      || value.generation < 1 || typeof value.payload !== 'string' || value.checksum !== checksum(value.payload)) {
      throw new Error('저장된 자료의 무결성을 확인할 수 없습니다.');
    }
    return value;
  }
  async function loadSnapshot(): Promise<string | null> {
    const results = await Promise.all([read(0), read(1)]);
    const valid: Envelope[] = [];
    let damaged = false;
    for (const raw of results) {
      if (raw === null) continue;
      try { valid.push(decode(raw)); } catch { damaged = true; }
    }
    if (damaged && !valid.length) throw new Error('기기 저장 자료를 읽지 못했습니다. 원본은 보존되어 있으며 새 저장을 중단했습니다.');
    valid.sort((a, b) => b.generation - a.generation);
    generation = valid[0]?.generation ?? 0;
    hydrated = true;
    if (damaged) onWarning?.('저장 사본 하나가 불완전하여 마지막 정상 사본을 복구했습니다. 대기 거래를 확인해 주세요.');
    return valid[0]?.payload ?? null;
  }
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  }
  return {
    load: () => serialized(loadSnapshot),
    save: (payload: string) => serialized(async () => {
      if (!hydrated) await loadSnapshot();
      const next = generation + 1;
      const envelope: Envelope = { version: 1, namespace, generation: next, payload, checksum: checksum(payload) };
      const encoded = JSON.stringify(envelope);
      await write(next % 2, encoded);
      const verified = await read(next % 2);
      if (verified === null || decode(verified).generation !== next || decode(verified).payload !== payload) {
        throw new Error('기기 저장을 확인하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.');
      }
      generation = next;
    }),
  };
}
