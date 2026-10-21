import { SherpaWhisperProvider } from './sherpaWhisperProvider';

let shared: SherpaWhisperProvider | null = null;

/** One provider (and so at most one native recognizer) per app process. */
export function getSharedSttProvider(): SherpaWhisperProvider {
  if (!shared) shared = new SherpaWhisperProvider();
  return shared;
}
