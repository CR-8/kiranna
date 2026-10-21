import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable } from 'react-native';

import { useRange } from '@/components/range';
import { Card, Row, Screen, T } from '@/components/ui';
import { fmtMoney, type PayMethod } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { billsIn } from '@/lib/insights';
import { useApp } from '@/lib/store';

/** Cash / UPI / not recorded for a period. The split is what was selected on each bill, not money checked against a bank. */
export default function Payments() {
  const t = useT();
  const router = useRouter();
  const app = useApp();
  const { range, invalid, ui } = useRange('today');
  const bills = useMemo(() => (range ? billsIn(app, range) : []), [app, range]);
  const rows = (['cash', 'upi', 'none'] as PayMethod[]).map((m) => {
    const mine = bills.filter((b) => (b.pay ?? 'none') === m);
    return { m, n: mine.length, paise: mine.reduce((a, b) => a + (b.totalPaise ?? 0), 0) };
  });
  const total = rows.reduce((a, r) => a + r.paise, 0);
  const label = { cash: t('payCash'), upi: t('payUpi'), none: t('payNone') };

  return (
    <Screen title={t('paymentSummary')}>
      {ui}
      {invalid || !range ? (
        <T c="ash">{t('dateHint')}</T>
      ) : (
        <Card>
          {rows.map((r) => (
            <Pressable
              key={r.m}
              accessibilityRole="button"
              accessibilityLabel={`${label[r.m]} ${fmtMoney(r.paise)}`}
              onPress={() => router.push(`/bills?from=${range.from}&to=${range.to}&pay=${r.m}`)}
              style={{ minHeight: 60, justifyContent: 'center' }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T v="sub">{label[r.m]}</T>
                <T v="h3">{fmtMoney(r.paise)}</T>
              </Row>
              <T c="ash">
                {t('billsCount', { n: r.n })}
                {r.m === 'upi' ? ` · ${t('notVerified')}` : ''}
              </T>
            </Pressable>
          ))}
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="caption" c="ash">{t('total')}</T>
            <T v="h3">{fmtMoney(total)}</T>
          </Row>
          <T v="caption" c="ash">{t('payDef')}</T>
        </Card>
      )}
    </Screen>
  );
}
