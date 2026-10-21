import { useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Platform } from 'react-native';

import { Btn, Card, Choice, Field, Row, Screen, T } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { STORAGE_ENGINE } from '@/lib/storage';
import { actions, useApp } from '@/lib/store';
import type { Lang } from '@/lib/engine';

export default function Settings() {
  const t = useT();
  const app = useApp();
  const [perm, ask] = useCameraPermissions();
  const [name, setName] = useState(app.shopName);
  const [saved, setSaved] = useState(false);

  const camStatus = !perm ? t('loading') : perm.granted ? t('granted') : perm.canAskAgain ? t('notAsked') : t('denied');

  return (
    <Screen title={t('settings')}>
      <Card>
        <Choice<Lang>
          label={t('language')}
          value={app.lang}
          onChange={(lang) => actions.setSettings({ lang })}
          options={[
            ['en', 'ENGLISH'],
            ['hi', 'हिन्दी'],
          ]}
        />
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
          <T v="sub">{t('notUsedYet')}</T>
        </Row>
      </Card>

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
        <T v="h3">{t('about')}</T>
        <T c="ash">
          Kirana POS {Constants.expoConfig?.version ?? ''} · {Platform.OS}
        </T>
        <T c="ash">ID {app.deviceId.slice(-6).toUpperCase()}</T>
      </Card>
    </Screen>
  );
}
