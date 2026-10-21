import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, type PermissionResponse } from 'expo-audio';
import { useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { Btn, Card, Field, LanguageSelector, Row, Screen, T } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { reconcile } from '@/lib/engine';
import { STORAGE_ENGINE } from '@/lib/storage';
import { actions, useApp } from '@/lib/store';
import { useModelInstall } from '@models/stt';

const mb = (bytes: number) => Math.round(bytes / 2 ** 20);

function useMicPermission(): [PermissionResponse | null, () => void] {
  const [perm, setPerm] = useState<PermissionResponse | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') getRecordingPermissionsAsync().then(setPerm, () => setPerm(null));
  }, []);
  const ask = useCallback(() => {
    requestRecordingPermissionsAsync().then(setPerm, () => undefined);
  }, []);
  return [perm, ask];
}

function VoiceModelCard() {
  const t = useT();
  const { state, install, cancel, uninstall } = useModelInstall();
  if (Platform.OS === 'web') return null;
  return (
    <Card>
      <T v="h3">{t('voiceModel')}</T>
      {state.status === 'installed' ? (
        <>
          <T v="sub">{t('voiceModelInstalled')}</T>
          <Btn kind="wash" label={t('removeModel')} onPress={() => void uninstall()} />
        </>
      ) : state.status === 'installing' ? (
        <>
          <T v="sub">
            {state.progress?.phase === 'verifying' || state.progress?.phase === 'finalizing'
              ? t('verifying')
              : t('downloading', {
                  pct: state.progress ? Math.floor((100 * state.progress.bytesDone) / state.progress.bytesTotal) : 0,
                })}
          </T>
          <Btn kind="wash" label={t('cancel')} onPress={cancel} />
        </>
      ) : state.status === 'checking' ? (
        <T c="ash">{t('loading')}</T>
      ) : (
        <>
          <T c="ash">{t('voiceModelAbout', { mb: mb(state.downloadBytes) })}</T>
          {state.status === 'failed' ? (
            <>
              <T v="sub">{t('downloadFailed')}</T>
              <T c="ash">{state.error.message}</T>
              <T c="ash">{t('downloadRetryHint')}</T>
            </>
          ) : null}
          <Btn label={t('downloadModel', { mb: mb(state.downloadBytes) })} onPress={() => void install()} />
        </>
      )}
    </Card>
  );
}

export default function Settings() {
  const t = useT();
  const app = useApp();
  const [perm, ask] = useCameraPermissions();
  const [name, setName] = useState(app.shopName);
  const [saved, setSaved] = useState(false);

  const [mic, askMic] = useMicPermission();
  const micStatus =
    Platform.OS === 'web' ? t('notOnWeb') : !mic ? t('loading') : mic.granted ? t('granted') : mic.canAskAgain ? t('notAsked') : t('denied');
  const camStatus = !perm ? t('loading') : perm.granted ? t('granted') : perm.canAskAgain ? t('notAsked') : t('denied');

  return (
    <Screen title={t('settings')}>
      <Card>
        <LanguageSelector label={t('language')} />
      </Card>

      <Card>
        <Field label={t('shopName')} value={name} onChangeText={(v) => { setName(v); setSaved(false); }} />
        <Btn
          kind="outline"
          label={saved ? `✓ ${t('saved')}` : t('save')}
          disabled={!name.trim()}
          onPress={() => { actions.setSettings({ shopName: name.trim() }); setSaved(true); }}
        />
      </Card>

      <Card>
        <T v="h3">{t('permissions')}</T>
        <Row style={{ justifyContent: 'space-between' }}>
          <T>{t('camera')}</T>
          <T v="sub">{camStatus}</T>
        </Row>
        {!perm?.granted && perm?.canAskAgain ? <Btn kind="outline" label={t('allowCamera')} onPress={ask} /> : null}
        <Row style={{ justifyContent: 'space-between' }}>
          <T>{t('microphone')}</T>
          <T v="sub">{micStatus}</T>
        </Row>
        {mic && !mic.granted && mic.canAskAgain ? <Btn kind="outline" label={t('allowMic')} onPress={askMic} /> : null}
      </Card>

      <VoiceModelCard />

      <Card>
        <T v="h3">{t('trustedDevices')}</T>
        <T c="ash">{t('noneTrusted')}</T>
      </Card>

      <Card>
        <T v="h3">{t('dataBackup')}</T>
        <T c="ash">{t('dataBackupHint')}</T>
        <T c="ash">
          {t('storage')}: {STORAGE_ENGINE}
        </T>
        <T c="ash">
          {app.products.length} {t('products')} · {app.sales.filter((s) => s.status === 'confirmed').length} {t('bills')}
        </T>
      </Card>

      <Card>
        <T v="h3">{t('stockCheck')}</T>
        <T c="ash">{reconcile(app).length ? t('stockCheckBad', { n: reconcile(app).length }) : t('stockCheckOk')}</T>
      </Card>

      <Card>
        <T v="h3">{t('about')}</T>
        <T c="ash">
          Kirana POS {Constants.expoConfig?.version ?? ''} · {Platform.OS}
        </T>
        <T c="ash">ID {app.deviceId.slice(-6).toUpperCase()}</T>
      </Card>
    </Screen>
  );
}
