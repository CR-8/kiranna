import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { Card, Empty, Row, Screen, T, Tag } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { confirmedBills, fmtMoney } from '@/lib/engine';
import { fmtDateTime, useT } from '@/lib/i18n';
import { useApp } from '@/lib/store';

export default function Bills() {
  const t = useT();
  const router = useRouter();
  const app = useApp();
  const bills = confirmedBills(app);

  return (
    <Screen title={t('history')}>
      {bills.length === 0 ? <Empty title={t('noBills')} hint={t('noBillsHint')} /> : null}
      {bills.map((b) => (
        <Pressable
          key={b.id}
          accessibilityRole="button"
          onPress={() => router.push(`/bills/${b.id}`)}
          style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, borderRadius: R.card, borderWidth: 1, borderColor: C.hairline })}>
          <Card style={{ borderWidth: 0 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="h3">{b.ref}</T>
              <T v="h3">{fmtMoney(b.totalPaise ?? 0)}</T>
            </Row>
            <T c="ash">{fmtDateTime(b.confirmedAt ?? b.createdAt)}</T>
            <Row style={{ flexWrap: 'wrap' }}>
              <Tag label={b.pay === 'cash' ? t('payCash') : b.pay === 'upi' ? t('payUpi') : t('payNone')} />
              <Tag label={b.pay === 'none' || !b.pay ? t('payStatusNone') : t('payStatusRecorded')} />
            </Row>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
