import { useRouter } from 'expo-router';

import { Btn, Card, Row, Screen, T } from '@/components/ui';
import { pendingEvents } from '@/lib/engine';
import { fmtDateTime, useT } from '@/lib/i18n';
import { useApp } from '@/lib/store';
import { transport } from '@/lib/sync';

export default function Sync() {
  const t = useT();
  const router = useRouter();
  const app = useApp();

  return (
    <Screen title={t('sync')}>
      <Card>
        <T v="caption" c="ash">{t('thisDevice')}</T>
        <T v="h3">{app.shopName}</T>
        <T c="ash">ID {app.deviceId.slice(-6).toUpperCase()}</T>
      </Card>

      <Card wash>
        <T v="caption" c="ash">{t('connectivity')}</T>
        <T v="sub">{transport.available ? t('ready') : t('notAvailable')}</T>
        {!transport.available ? <T c="ash">{t(transport.reason)}</T> : null}
        <T c="ash">{t('localStillWorks')}</T>
      </Card>

      <Card>
        <T v="caption" c="ash">{t('nearbyDevices')}</T>
        <T v="sub">{t('noneFound')}</T>
        <T v="caption" c="ash">{t('trustedDevices')}</T>
        <T v="sub">{t('noneTrusted')}</T>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T c="ash">{t('pendingChanges')}</T>
          <T v="h3">{pendingEvents(app)}</T>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T c="ash">{t('lastSync')}</T>
          <T v="sub">{app.lastSyncAt ? fmtDateTime(app.lastSyncAt) : t('never')}</T>
        </Row>
      </Card>

      <Row>
        <Btn kind="outline" label={t('connect')} disabled style={{ flex: 1 }} />
        <Btn label={t('syncNow')} onPress={() => router.push('/sync/result')} style={{ flex: 1 }} />
      </Row>
    </Screen>
  );
}
