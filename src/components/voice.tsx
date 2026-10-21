import { useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { Btn, Card, T, type MicState } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { HINGLISH_SWIFT, totalDownloadBytes, useVoiceCommand, type STTResult, type VoiceCommandState } from '@models/stt';

const MODEL_MB = Math.round(totalDownloadBytes(HINGLISH_SWIFT) / 2 ** 20);

/**
 * Push-to-talk wiring for a screen. `onTranscript` receives the raw model text;
 * interpreting it (product, quantity, action) is the inventory layer's job.
 */
export function useVoiceInput(onTranscript: (result: STTResult) => void) {
  const voice = useVoiceCommand({ onTranscript });
  const [webNote, setWebNote] = useState(false);
  const busy = voice.state.status === 'listening' || voice.state.status === 'processing';

  const toggle = useCallback(() => {
    if (Platform.OS === 'web') return setWebNote(true);
    if (voice.state.status === 'listening') void voice.stop();
    else if (voice.state.status !== 'processing') void voice.start();
  }, [voice]);

  return { ...voice, toggle, busy, webNote };
}

/** Maps recognizer state onto the app's MicrophoneButton states. */
export function micStateOf(voice: ReturnType<typeof useVoiceInput>, heard: string | null): MicState {
  const s = voice.state.status;
  if (Platform.OS === 'web' || s === 'model_unavailable') return 'unavailable';
  if (s === 'listening' || s === 'processing') return s;
  if (s === 'transcript' || (s === 'idle' && heard)) return 'results';
  return 'ready';
}

/** "What I heard" card: shows the transcript or the reason there is none. */
export function VoiceStatus({ voice, heard }: { voice: ReturnType<typeof useVoiceInput>; heard: string | null }) {
  const t = useT();
  const router = useRouter();
  const s = voice.state;

  let body: ReactNode;
  if (voice.webNote) {
    body = <T c="ash">{t('voiceWeb')}</T>;
  } else if (s.status === 'model_unavailable') {
    body = (
      <>
        <T v="sub">{t('voiceModelMissing')}</T>
        <T c="ash">{t('voiceModelMissingHint', { mb: MODEL_MB })}</T>
        <Btn kind="outline" label={t('openAppSettings')} onPress={() => router.push('/settings')} />
      </>
    );
  } else if (s.status === 'error') {
    const hint =
      s.error.code === 'SILENT_AUDIO' || s.error.code === 'EMPTY_TRANSCRIPT'
        ? t('voiceNoSpeech')
        : s.error.code === 'PERMISSION_DENIED'
          ? t('voiceMicDenied')
          : t('voiceFailedHint');
    body = (
      <>
        <T v="sub">{t('voiceFailed')}</T>
        <T c="ash">{hint}</T>
      </>
    );
  } else if (s.status === 'cancelled') {
    body = <T c="ash">{t('voiceCancelled')}</T>;
  } else if (s.status === 'listening' || s.status === 'processing') {
    body = (
      <>
        <T v="sub">{s.status === 'listening' ? t('listening') : t('processing')}</T>
        <Btn kind="wash" label={t('cancelVoice')} onPress={voice.cancel} />
      </>
    );
  } else if (heard) {
    body = (
      <>
        <T v="sub">{heard}</T>
        <T c="ash">{t('voiceCheckHint')}</T>
      </>
    );
  } else {
    body = <T v="sub">{t('transcriptEmpty')}</T>;
  }

  return (
    <Card wash>
      <T v="caption" c="ash">{t('transcript')}</T>
      {body}
    </Card>
  );
}
