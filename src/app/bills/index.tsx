import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable } from 'react-native';

import { useRange } from '@/components/range';
import { Btn, Choice, Empty, Field, Row, Screen, T, Tag } from '@/components/ui';
import { C } from '@/constants/theme';
import { fmtMoney, openDrafts, saleTotal, voidedBills, type PayMethod, type Sale } from '@/lib/engine';
import { fmtDateTime, useT } from '@/lib/i18n';
import { billsIn, inRange } from '@/lib/insights';
import { useApp } from '@/lib/store';

const PAGE = 30;
type Kind = 'done' | 'draft' | 'voided';

/** Bill history. Reports and Home link here with a date range and/or payment method already chosen. */
export default function Bills() {
  const t = useT();
  const router = useRouter();
  const app = useApp();
  const p = useLocalSearchParams<{ from?: string; to?: string; pay?: PayMethod; status?: Kind }>();
  const preset = p.from && p.to ? { from: Number(p.from), to: Number(p.to) } : undefined;
  const { range, invalid, ui } = useRange('all', { all: true, preset });
  const [kind, setKind] = useState<Kind>(p.status === 'voided' ? 'voided' : 'done');
  const [pay, setPay] = useState<PayMethod | 'any'>(p.pay ?? 'any');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(!!(preset || p.pay));
  const [shown, setShown] = useState(PAGE);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base: Sale[] =
      kind === 'draft' ? openDrafts(app).filter((d) => d.items.length) : kind === 'voided' ? voidedBills(app) : range ? billsIn(app, range) : app.sales.filter((b) => b.status === 'confirmed').sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0));
    return base.filter((b) => {
      if (kind === 'voided' && range && !inRange(b.confirmedAt, range)) return false;
      if (kind !== 'draft' && pay !== 'any' && (b.pay ?? 'none') !== pay) return false;
      return !needle || (b.ref ?? '').toLowerCase().includes(needle) || b.items.some((i) => i.name.toLowerCase().includes(needle));
    });
  }, [app, kind, range, pay, q]);

  return (
    <Screen title={t('history')} tab="history" scroll={false}>
      <Field label={t('searchBills')} placeholder={t('searchBillsHint')} value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} />
      <Choice<Kind> row value={kind} onChange={setKind} options={[['done', t('kDone')], ['draft', `${t('kDraft')} (${openDrafts(app).filter((d) => d.items.length).length})`], ['voided', t('kVoided')]]} />
      <Btn kind="wash" size="sm" label={filters ? t('hideFilters') : t('showFilters')} onPress={() => setFilters((v) => !v)} />
      {filters ? (
        <>
          {ui}
          {kind !== 'draft' ? (
            <Choice<PayMethod | 'any'> row value={pay} onChange={setPay} options={[['any', t('rangeAll')], ['cash', t('payCash')], ['upi', t('payUpi')], ['none', t('payNone')]]} />
          ) : null}
          {invalid ? <T c="ash">{t('dateHint')}</T> : null}
        </>
      ) : null}
      <FlatList
        style={{ flex: 1 }}
        data={rows.slice(0, shown)}
        keyExtractor={(b) => b.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty title={t('noBills')} hint={t('noBillsHint')} />}
        ListFooterComponent={rows.length > shown ? <Btn kind="outline" label={t('showOlder')} onPress={() => setShown((n) => n + PAGE)} style={{ marginVertical: 12 }} /> : undefined}
        renderItem={({ item: b }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${b.ref ?? t('saleN', { n: b.label })} ${fmtMoney(b.totalPaise ?? saleTotal(b.items))}`}
            onPress={() => router.push(b.status === 'draft' ? `/sale/${b.id}` : `/bills/${b.id}`)}
            style={({ pressed }) => ({ minHeight: 64, paddingVertical: 10, justifyContent: 'center', borderBottomWidth: 1, borderColor: C.hairline, opacity: pressed ? 0.75 : 1 })}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="sub">{b.ref ?? t('saleN', { n: b.label })}</T>
              <T v="sub">{fmtMoney(b.totalPaise ?? saleTotal(b.items))}</T>
            </Row>
            <Row style={{ gap: 8, flexWrap: 'wrap' }}>
              <T c="ash">{fmtDateTime(b.confirmedAt ?? b.createdAt)}</T>
              {b.status === 'draft' ? <Tag label={t('kDraft')} /> : b.status === 'voided' ? <Tag label={t('reversed')} kind="alert" /> : <Tag label={b.pay === 'cash' ? t('payCash') : b.pay === 'upi' ? t('payUpi') : t('payStatusNone')} />}
            </Row>
          </Pressable>
        )}
      />
    </Screen>
  );
}
