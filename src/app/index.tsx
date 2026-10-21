import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useQtyLabel } from '@/components/sale';
import { Btn, Card, LanguageSelector, Row, Screen, Stat, SyncStatus, T, Tag, useOffline } from '@/components/ui';
import { C } from '@/constants/theme';
import { fmtMoney, openDrafts } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { rangeFor, restockSoon, salesReport, stockAlerts, stockCounts } from '@/lib/insights';
import { actions, useApp } from '@/lib/store';

/** Today at a glance: money, what needs restocking, sync. Counts and money come straight from local data. */
export default function Home() {
  const t = useT();
  const router = useRouter();
  const app = useApp();
  const qtyLabel = useQtyLabel();
  const offline = useOffline();
  const [now, setNow] = useState(Date.now);
  useFocusEffect(useCallback(() => setNow(Date.now()), []));

  const today = useMemo(() => salesReport(app, rangeFor('today', now), 0), [app, now]);
  const counts = useMemo(() => stockCounts(app), [app]);
  const alerts = useMemo(() => stockAlerts(app, now).filter((r) => !r.hidden), [app, now]);
  const soon = useMemo(() => restockSoon(app, now), [app, now]);
  const drafts = openDrafts(app).filter((d) => d.items.length).length;
  const day = rangeFor('today', now);
  const urgent = alerts.slice(0, 3);

  return (
    <Screen title={t('appName')} tab="home">
      <T v="h3" numberOfLines={1}>{app.shopName}</T>
      {offline ? <T v="sub">{t('offlineBanner')}</T> : null}
      <Btn label={t('newBill')} onPress={() => router.push(`/sale/${actions.startSale()}`)} style={{ minHeight: 64 }} />
      {drafts ? <Btn kind="outline" label={`${t('openSalesBtn')} (${drafts})`} onPress={() => router.push('/sales')} /> : null}

      <Card>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('todaysSales')} ${fmtMoney(today.grossPaise)}`} onPress={() => router.push(`/bills?from=${day.from}&to=${day.to}`)}>
          <T v="caption" c="ash">{t('todaysSales')}</T>
          <T v="h1">{fmtMoney(today.grossPaise)}</T>
          <T c="ash">{t('billsCount', { n: today.billCount })}</T>
        </Pressable>
        <Row style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Stat label={t('payCash')} value={fmtMoney(today.pay.cash)} onPress={() => router.push(`/bills?from=${day.from}&to=${day.to}&pay=cash`)} />
          <Stat label={t('payUpi')} value={fmtMoney(today.pay.upi)} note={t('notVerified')} onPress={() => router.push(`/bills?from=${day.from}&to=${day.to}&pay=upi`)} />
          <Stat label={t('payNone')} value={fmtMoney(today.pay.none)} onPress={() => router.push(`/bills?from=${day.from}&to=${day.to}&pay=none`)} />
        </Row>
      </Card>

      <Card style={{ borderWidth: counts.out ? 2 : 1, borderColor: counts.out ? C.ink : C.hairline }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="h3">{t('restockTitle')}</T>
          <Btn size="sm" kind="outline" label={t('openRestock')} onPress={() => router.push('/restock')} />
        </Row>
        <Row style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Stat label={t('lowStock')} value={String(counts.low)} />
          <Stat label={t('outOfStock')} value={String(counts.out)} />
          <Stat label={t('tabSoon')} value={soon.enoughHistory ? String(soon.rows.length) : '—'} note={soon.enoughHistory ? undefined : t('soonNeedHistory')} />
        </Row>
        {urgent.length === 0 ? <T c="ash">{t('noRestockNow')}</T> : null}
        {urgent.map((r) => (
          <Pressable
            key={r.p.id}
            accessibilityRole="button"
            accessibilityLabel={r.p.name}
            onPress={() => router.push(`/product/${r.p.id}`)}
            style={{ minHeight: 56, paddingVertical: 6, justifyContent: 'center', borderTopWidth: 1, borderColor: C.hairline }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="sub" style={{ flex: 1 }} numberOfLines={1}>{r.p.name}</T>
              <Tag label={r.level === 'OUT' ? t('outOfStock') : t('lowStock')} kind={r.level === 'OUT' ? 'alert' : 'warn'} />
            </Row>
            <T c="ash">
              {t('stockLabel')} {qtyLabel(r.p.stock, r.p.unit)} · {t('minShort')} {qtyLabel(r.p.lowAt, r.p.unit)}
              {r.sug.qty > 0 ? ` · ${t('orderShort')} ${qtyLabel(r.sug.qty, r.p.unit)}` : ''}
            </T>
          </Pressable>
        ))}
        {alerts.length > urgent.length ? <T c="ash">{t('moreAlerts', { n: alerts.length - urgent.length })}</T> : null}
      </Card>

      <SyncStatus />
      <View style={{ marginTop: 4 }}>
        <LanguageSelector />
      </View>
    </Screen>
  );
}
