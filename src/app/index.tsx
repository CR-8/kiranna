import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Btn, Card, Row, Screen, T, useOffline } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { fmtMoney, openDrafts, pendingEvents, todaySummary } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { actions, useApp } from '@/lib/store';

function Action({ n, title, hint, to, primary }: { n: string; title: string; hint: string; to: () => void; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={to}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 300,
        minHeight: 150,
        padding: 20,
        gap: 8,
        justifyContent: 'space-between',
        borderRadius: R.card,
        borderWidth: 1,
        borderColor: primary ? C.ink : C.hairline,
        backgroundColor: primary ? C.accent : C.paper,
        opacity: pressed ? 0.8 : 1,
      })}>
      <T v="caption" c={primary ? 'ink' : 'ash'}>{n}</T>
      <View style={{ gap: 4 }}>
        <T v="h2">{title}</T>
        <T c={primary ? 'ink' : 'ash'}>{hint}</T>
      </View>
    </Pressable>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 120, gap: 2 }}>
      <T v="caption" c="ash">{label}</T>
      <T v="h3" c="paper">{value}</T>
    </View>
  );
}

export default function Home() {
  const t = useT();
  const router = useRouter();
  const app = useApp();
  const offline = useOffline();
  const [now] = useState(Date.now); // fixed at mount: "today" only matters when the screen opens
  const today = todaySummary(app, now);
  const go = (href: Href) => () => router.push(href);

  const newBill = () => router.push(`/sale/${actions.startSale()}`);

  return (
    <Screen title={t('appName')} back={false}>
      <T v="h1">{app.shopName}</T>

      {offline ? (
        <Card wash>
          <T v="sub">{t('offlineBanner')}</T>
        </Card>
      ) : null}

      <View style={{ backgroundColor: C.obsidian, borderRadius: R.card, padding: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        <Metric label={t('todaysSales')} value={fmtMoney(today.totalPaise)} />
        <Metric label={t('billsToday')} value={String(today.billCount)} />
        <Metric label={t('openSales')} value={String(openDrafts(app).length)} />
        <Metric label={t('pendingChanges')} value={String(pendingEvents(app))} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        <Action n="01" title={t('newBill')} hint={t('newBillHint')} to={newBill} primary />
        <Action n="02" title={t('stock')} hint={t('stockHint')} to={go('/inventory')} />
        <Action n="03" title={t('history')} hint={t('historyHint')} to={go('/bills')} />
        <Action n="04" title={t('sync')} hint={t('syncHint')} to={go('/sync')} />
      </View>

      <Row>
        <Btn kind="outline" label={t('todaysSales')} onPress={go('/today')} style={{ flex: 1 }} />
        <Btn kind="outline" label={t('settings')} onPress={go('/settings')} style={{ flex: 1 }} />
      </Row>
    </Screen>
  );
}
