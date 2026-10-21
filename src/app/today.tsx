import { useState } from 'react';

import { useQtyLabel } from '@/components/sale';
import { Card, Empty, Row, Screen, T } from '@/components/ui';
import { fmtMoney, todaySummary } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { useApp } from '@/lib/store';

const SHOWN = 5;

export default function Today() {
  const t = useT();
  const qtyLabel = useQtyLabel();
  const app = useApp();
  const [now] = useState(Date.now);
  const s = todaySummary(app, now);

  return (
    <Screen title={t('todaysSales')}>
      <Card>
        <T v="h1">{fmtMoney(s.totalPaise)}</T>
        <T c="ash">{t('billsCount', { n: s.billCount })}</T>
        <T c="ash">{s.profitPaise === null ? t('profitNA') : `${t('profit')}: ${fmtMoney(s.profitPaise)}`}</T>
      </Card>

      {s.billCount === 0 ? <Empty title={t('noBillsToday')} /> : null}

      <Card>
        <T v="h3">{t('bestSelling')}</T>
        {s.best.length === 0 ? <T c="ash">{t('noSalesYet')}</T> : null}
        {s.best.slice(0, 3).map((b) => (
          <Row key={b.name} style={{ justifyContent: 'space-between' }}>
            <T style={{ flex: 1 }}>{b.name}</T>
            <T v="sub">{qtyLabel(b.qty, b.unit)}</T>
          </Row>
        ))}
      </Card>

      <Card>
        <T v="h3">{t('lowStockList')}</T>
        {s.low.length === 0 ? <T c="ash">{t('noLowStock')}</T> : null}
        {s.low.slice(0, SHOWN).map((p) => (
          <Row key={p.id} style={{ justifyContent: 'space-between' }}>
            <T style={{ flex: 1 }}>{p.name}</T>
            <T v="sub">{p.stock <= 0 ? t('outOfStock') : qtyLabel(p.stock, p.unit)}</T>
          </Row>
        ))}
        {s.low.length > SHOWN ? <T c="ash">+{s.low.length - SHOWN} · {t('tabStock')}</T> : null}
      </Card>
    </Screen>
  );
}
