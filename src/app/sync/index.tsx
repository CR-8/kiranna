import { useState } from 'react';

import { Btn, Card, Row, Screen, SyncStatus, T } from '@/components/ui';
import { fmtDateTime, useT } from '@/lib/i18n';
import { useApp } from '@/lib/store';
import { runSync, transport, type SyncResult } from '@/lib/sync';

/** One screen: this phone, who is nearby, what is pending, one button. States are never faked. */
export default function Sync() {
  const t = useT();
  const app = useApp();
  const [r, setR] = useState<SyncResult | null>(null);
  const failed = r?.status === 'FAILED';

  return (
    <Screen
      title={t('sync')}
      footer={<Btn label={failed ? t('retry') : t('connect')} onPress={() => setR(runSync())} />}>
      <Card>
        <T v="h2">{t(`st_${r ? r.status : 'IDLE'}`)}</T>
        {r?.reason || !transport.available ? <T c="ash">{t(r?.reason ?? transport.reason)}</T> : null}
        {failed ? <T v="sub">{t('syncCouldNot')}</T> : null}
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T c="ash">{t('thisDevice')}</T>
          <T v="sub">{app.shopName}</T>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T c="ash">{t('nearbyDevices')}</T>
          <T v="sub">{t('noneFound')}</T>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T c="ash">{t('trustedDevices')}</T>
          <T v="sub">{t('noneTrusted')}</T>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T c="ash">{t('lastSync')}</T>
          <T v="sub">{app.lastSyncAt ? fmtDateTime(app.lastSyncAt) : t('never')}</T>
        </Row>
      </Card>

      <SyncStatus />
      <T c="ash">{t('localStillWorks')}</T>
    </Screen>
  );
}
