import { useState } from 'react';

import { Card, Empty, Row, Screen, T } from '@/components/ui';
import { useQtyLabel } from '@/components/sale';
import { fmtMoney, todaySummary } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { useApp } from '@/lib/store';

export default function Today() {
  const t = useT();
  const qtyLabel = useQtyLabel();
  const app = useApp();
  const [now] = useState(Date.now);
  const s = todaySummary(app, now);

  return (
    <Screen title={t('todaysSales')}>
      <Card>
        <T v="caption" c="ash">{t('todaysSales')}</T>
        <T v="h1">{fmtMoney(s.totalPaise)}</T>
        <T c="ash">{t('billsCount', { n: s.billCount })}</T>
        <T c="ash">{s.profitPaise === null ? t('profitNA') : `${t('profit')}: ${fmtMoney(s.profitPaise)}`}</T>
      </Card>

      <Card>
        <T v="h3">{t('bestSelling')}</T>
        {s.best.length === 0 ? <T c="ash">{t('noSalesYet')}</T> : null}
        {s.best.map((b) => (
          <Row key={b.name} style={{ justifyContent: 'space-between' }}>
            <T style={{ flex: 1 }}>{b.name}</T>
            <T v="sub">{qtyLabel(b.qty, b.unit)}</T>
          </Row>
        ))}
      </Card>

      <Card>
        <T v="h3">{t('lowStockList')}</T>
        {s.low.length === 0 ? <T c="ash">{t('noLowStock')}</T> : null}
        {s.low.map((p) => (
          <Row key={p.id} style={{ justifyContent: 'space-between' }}>
            <T style={{ flex: 1 }}>{p.name}</T>
            <T v="sub">{p.stock <= 0 ? t('outOfStock') : qtyLabel(p.stock, p.unit)}</T>
          </Row>
        ))}
      </Card>

      <Card>
        <T v="h3">{t('movements')}</T>
        <Row style={{ justifyContent: 'space-between' }}><T>{t('mvSold')}</T><T v="sub">{s.movements.sold}</T></Row>
        <Row style={{ justifyContent: 'space-between' }}><T>{t('mvRestocked')}</T><T v="sub">{s.movements.restocked}</T></Row>
        <Row style={{ justifyContent: 'space-between' }}><T>{t('mvOpened')}</T><T v="sub">{s.movements.opened}</T></Row>
      </Card>
      {s.billCount === 0 ? <Empty title={t('noBillsToday')} /> : null}
    </Screen>
  );
}
