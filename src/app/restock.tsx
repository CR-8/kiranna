import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { AlertCard } from '@/components/restock';
import { useQtyLabel } from '@/components/sale';
import { Btn, Card, ConfirmAction, Choice, Empty, QuantityStepper, Row, Screen, T } from '@/components/ui';
import { C } from '@/constants/theme';
import { fmtMoney, lineTotal, openList, outstanding, stepFor, type Purchase } from '@/lib/engine';
import { fmtDateTime, useT } from '@/lib/i18n';
import { MIN_HISTORY_DAYS, WINDOW_DAYS, restockSoon, stockAlerts } from '@/lib/insights';
import { actions, flash, useApp } from '@/lib/store';

type Tab = 'now' | 'out' | 'soon' | 'list';

/** Restock Center: what needs restocking now, what is out, what will be soon, and the list being built. */
export default function RestockCenter() {
  const t = useT();
  const router = useRouter();
  const app = useApp();
  const qtyLabel = useQtyLabel();
  const [tab, setTab] = useState<Tab>('now');
  const [showHidden, setShowHidden] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [now, setNow] = useState(Date.now);
  useFocusEffect(useCallback(() => setNow(Date.now()), []));

  const alerts = useMemo(() => stockAlerts(app, now), [app, now]);
  const soon = useMemo(() => restockSoon(app, now), [app, now]);
  const list = openList(app);
  const visible = alerts.filter((r) => showHidden || !r.hidden);
  const hiddenCount = alerts.filter((r) => r.hidden).length;
  const rows = tab === 'out' ? visible.filter((r) => r.level === 'OUT') : visible;
  const ordered = app.purchases.filter((p) => p.status === 'ordered');

  const hiddenToggle = hiddenCount ? (
    <Btn kind="wash" size="sm" label={showHidden ? t('hideHidden') : t('showHidden', { n: hiddenCount })} onPress={() => setShowHidden((v) => !v)} style={{ marginVertical: 8 }} />
  ) : undefined;

  return (
    <Screen title={t('restockCenter')} tab="stock" scroll={false}>
      <Choice<Tab>
        value={tab}
        onChange={setTab}
        options={[
          ['now', `${t('tabNow')} (${visible.length})`],
          ['out', `${t('tabOut')} (${visible.filter((r) => r.level === 'OUT').length})`],
          ['soon', `${t('tabSoon')} (${soon.rows.length})`],
          ['list', `${t('tabList')} (${list?.lines.length ?? 0})`],
        ]}
      />

      {tab === 'now' || tab === 'out' ? (
        <FlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={(r) => r.p.id}
          contentContainerStyle={{ gap: 12 }}
          ListEmptyComponent={<Empty title={t(tab === 'out' ? 'noOut' : 'noRestockNow')} hint={t('noRestockHint')} />}
          ListFooterComponent={hiddenToggle}
          renderItem={({ item }) => <AlertCard row={item} />}
        />
      ) : null}

      {tab === 'soon' ? (
        <FlatList
          style={{ flex: 1 }}
          data={soon.rows}
          keyExtractor={(r) => r.p.id}
          contentContainerStyle={{ gap: 12 }}
          ListHeaderComponent={soon.enoughHistory ? <T c="ash">{t('soonEstimate', { days: WINDOW_DAYS })}</T> : undefined}
          ListEmptyComponent={
            soon.enoughHistory ? (
              <Empty title={t('noSoon')} hint={t('soonEstimate', { days: WINDOW_DAYS })} />
            ) : (
              <Empty title={t('soonNeedHistory')} hint={t('soonNeedHistoryHint', { have: Math.floor(soon.historyDays), need: MIN_HISTORY_DAYS })} />
            )
          }
          renderItem={({ item: r }) => (
            <Card>
              <Pressable accessibilityRole="button" accessibilityLabel={r.p.name} onPress={() => router.push(`/product/${r.p.id}`)}>
                <T v="sub">{r.p.name}</T>
              </Pressable>
              <T v="h3">{t('daysLeft', { n: r.daysLeft < 1 ? '<1' : Math.round(r.daysLeft) })}</T>
              <T c="ash">{t('soonWhy', { have: qtyLabel(r.p.stock, r.p.unit), rate: qtyLabel(Math.round(r.perDay), r.p.unit) })}</T>
              <Btn
                size="sm"
                label={t('addToList')}
                onPress={() => {
                  actions.addToList(r.p.id, r.sug.qty || stepFor(r.p.unit));
                  flash(t('addedToList'));
                }}
              />
            </Card>
          )}
        />
      ) : null}

      {tab === 'list' ? (
        <FlatList
          style={{ flex: 1 }}
          data={list?.lines ?? []}
          keyExtractor={(l) => l.id}
          ListEmptyComponent={<Empty title={t('listEmpty')} hint={t('listEmptyHint')} />}
          renderItem={({ item: l }) => (
            <View style={{ paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderColor: C.hairline }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <T v="sub" style={{ flex: 1 }}>{l.name}</T>
                <T c="ash">{l.costPaise === undefined ? t('costNotRecorded') : fmtMoney(lineTotal(l.costPaise, l.qty))}</T>
              </Row>
              <Row>
                <QuantityStepper qty={l.qty} unit={l.unit} onChange={(q) => actions.setLineQty(list!.id, l.id, q)} />
                <View style={{ flex: 1 }} />
                <Btn size="sm" kind="outline" label="✕" a11y={`${t('remove')} ${l.name}`} onPress={() => actions.removeLine(list!.id, l.id)} style={{ width: 48 }} />
              </Row>
            </View>
          )}
          ListFooterComponent={
            <View style={{ gap: 10, paddingTop: 12 }}>
              {list?.lines.length ? <ListTotal list={list} /> : null}
              {list?.lines.length ? (
                <>
                  <Btn label={t('receiveStock')} onPress={() => router.push(`/purchase/${list.id}`)} />
                  <Btn kind="outline" label={t('markOrdered')} onPress={() => { actions.markOrdered(list.id); flash(t('markedOrdered')); }} />
                  {discard ? (
                    <ConfirmAction ask={t('discardAsk')} yes={t('discardYes')} no={t('keep')} onYes={() => { actions.cancelPurchase(list.id); setDiscard(false); }} onNo={() => setDiscard(false)} />
                  ) : (
                    <Btn kind="wash" size="sm" label={t('discardList')} onPress={() => setDiscard(true)} />
                  )}
                </>
              ) : null}
              {ordered.length ? <T v="h3" style={{ marginTop: 8 }}>{t('onOrderTitle')}</T> : null}
              {ordered.map((p) => (
                <OrderedRow key={p.id} p={p} onOpen={() => router.push(`/purchase/${p.id}`)} />
              ))}
            </View>
          }
        />
      ) : null}
    </Screen>
  );
}

/** Estimated cost only when every line has a cost; otherwise say it is unknown instead of showing a partial sum. */
function ListTotal({ list }: { list: Purchase }) {
  const t = useT();
  const missing = list.lines.filter((l) => l.costPaise === undefined).length;
  const total = list.lines.reduce((a, l) => a + (l.costPaise === undefined ? 0 : lineTotal(l.costPaise, l.qty)), 0);
  return (
    <Card wash>
      <T v="caption" c="ash">{t('estCost')}</T>
      <T v="h3">{missing ? t('costUnknown') : fmtMoney(total)}</T>
      {missing ? <T c="ash">{t('costMissingN', { n: missing })}</T> : null}
    </Card>
  );
}

function OrderedRow({ p, onOpen }: { p: Purchase; onOpen: () => void }) {
  const t = useT();
  const left = p.lines.filter((l) => outstanding(l) > 0).length;
  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={{ minHeight: 56, justifyContent: 'center', paddingVertical: 8, borderBottomWidth: 1, borderColor: C.hairline }}>
      <T v="sub">{t('orderedOn', { date: fmtDateTime(p.orderedAt ?? p.createdAt) })}</T>
      <T c="ash">{t('stillWaiting', { n: left })}</T>
    </Pressable>
  );
}
