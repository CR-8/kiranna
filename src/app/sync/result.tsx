import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Btn, Card, Row, Screen, T, Tag } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { runSync } from '@/lib/sync';

export default function SyncResult() {
  const t = useT();
  const router = useRouter();
  const [r, setR] = useState(runSync);

  return (
    <Screen
      title={t('syncResult')}
      back={false}
      footer={
        <Row>
          <Btn kind="outline" label={t('retry')} onPress={() => setR(runSync())} style={{ flex: 1 }} />
          <Btn label={t('done')} onPress={() => router.replace('/')} style={{ flex: 1 }} />
        </Row>
      }>
      <Card>
        <Tag label={t(`st_${r.status}`)} kind={r.status === 'FAILED' ? 'alert' : r.status === 'COMPLETE' ? 'active' : 'plain'} />
        <T v="h1">{t(`st_${r.status}`)}</T>
        {r.reason ? <T c="ash">{t(r.reason)}</T> : null}
      </Card>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T c="ash">{t('changesSent')}</T>
          <T v="h3">{r.sent}</T>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T c="ash">{t('changesReceived')}</T>
          <T v="h3">{r.received}</T>
        </Row>
      </Card>
      <Card wash>
        <T>{t('localStillWorks')}</T>
      </Card>
    </Screen>
  );
}
