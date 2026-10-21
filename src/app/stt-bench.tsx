import { Directory, File, Paths } from 'expo-file-system';
import { Redirect } from 'expo-router';
import { useState } from 'react';

import { Btn, Card, Screen, T } from '@/components/ui';
import { getSharedSttProvider, isSTTError } from '@models/stt';

/**
 * DEV-ONLY on-device STT benchmark (not reachable in release builds).
 * Transcribes every WAV in <document>/stt-bench/ with the real native recognizer
 * and writes <document>/stt-bench/results.json. See models/docs/STT_DEVICE_TESTING.md.
 */
export default function SttBench() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  if (!__DEV__) return <Redirect href="/" />;

  const run = async (passes: number) => {
    setRunning(true);
    const out: string[] = [];
    const push = (s: string) => {
      out.push(s);
      setLog([...out]);
    };
    const provider = getSharedSttProvider();
    const dir = new Directory(Paths.document, 'stt-bench');
    const results: Record<string, unknown>[] = [];
    try {
      await provider.release();
      let t0 = Date.now();
      await provider.initialize();
      const coldInitMs = Date.now() - t0;
      await provider.release();
      t0 = Date.now();
      await provider.initialize();
      const warmInitMs = Date.now() - t0;
      push(`init cold ${coldInitMs} ms, re-init ${warmInitMs} ms`);

      const wavs = dir.exists ? dir.list().filter((f): f is File => f instanceof File && f.name.endsWith('.wav')) : [];
      wavs.sort((a, b) => a.name.localeCompare(b.name));
      push(`${wavs.length} wav files`);
      for (let pass = 0; pass < passes; pass++) {
        for (const f of wavs) {
          const t = Date.now();
          try {
            const r = await provider.transcribe(f.uri);
            results.push({ file: f.name, pass, transcript: r.transcript, durationMs: r.durationMs, inferenceMs: r.inferenceMs, wallMs: Date.now() - t });
            if (pass === 0) push(`${f.name}: ${r.inferenceMs} ms  ${r.transcript}`);
          } catch (e) {
            results.push({ file: f.name, pass, error: isSTTError(e) ? e.code : String(e), wallMs: Date.now() - t });
            if (pass === 0) push(`${f.name}: ${isSTTError(e) ? e.code : String(e)}`);
          }
        }
      }
      await new File(dir, 'results.json').write(JSON.stringify({ coldInitMs, warmInitMs, passes, results }, null, 1));
      push('wrote stt-bench/results.json');
    } catch (e) {
      push(`FAILED: ${isSTTError(e) ? `${e.code} ${e.message}` : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Screen title="STT BENCH">
      <Btn label="RUN (1 PASS)" disabled={running} onPress={() => void run(1)} />
      <Btn kind="outline" label="RUN (5 PASSES, MEMORY SOAK)" disabled={running} onPress={() => void run(5)} />
      <Card wash>
        {log.map((l, i) => (
          <T key={i} v="caption">
            {l}
          </T>
        ))}
      </Card>
    </Screen>
  );
}
