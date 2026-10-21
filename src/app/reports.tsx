import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useRange } from '@/components/range';
import { useQtyLabel } from '@/components/sale';
import { Card, Choice, Row, Screen, Stat, T } from '@/components/ui';
import { C } from '@/constants/theme';
import { fmtMoney } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { purchaseSpend, salesReport, stockValue, type ProductSales } from '@/lib/insights';
import { useApp } from '@/lib/store';

const fmtDay = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** Every number here has a one-line definition under it, and most open the bills or products behind them. */
export default function Reports() {
  const t = useT();
  const router = useRouter();
  const qtyLabel = useQtyLabel();
  const app = useApp();
  const { range, invalid, ui } = useRange('today');
  const [by, setBy] = useState<'qty' | 'rev'>('qty');
  const rep = useMemo(() => (range ? salesReport(app, range) : null), [app, range]);
  const spend = useMemo(() => (range ? purchaseSpend(app, range) : null), [app, range]);
  const value = useMemo(() => stockValue(app), [app]);
  const bills = (extra = '') => (range ? () => router.push(`/bills?from=${range.from}&to=${range.to}${extra}`) : undefined);
  const best = rep ? (by === 'qty' ? rep.best : rep.bestByRevenue) : [];
  const top = Math.max(1, ...(rep?.byDay.map((d) => d.paise) ?? [1]));
  const open = (x: { productId: string }) => () => router.push(`/product/${x.productId}`);
  const sold = (x: ProductSales) => `${qtyLabel(x.qty, x.unit)} · ${fmtMoney(x.revenuePaise)}`;

  return (
    <Screen title={t('reports')} tab="reports">
      {ui}
      {invalid || !rep || !range ? (
        <T c="ash">{t('dateHint')}</T>
      ) : (
        <>
          <Card>
            <T v="caption" c="ash">{t('salesTitle')}</T>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('salesTitle')} ${fmtMoney(rep.grossPaise)}`} onPress={bills()}>
              <T v="h1">{fmtMoney(rep.grossPaise)}</T>
            </Pressable>
            <Row style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <Stat label={t('billsTitle')} value={String(rep.billCount)} onPress={bills()} />
              <Stat label={t('avgBill')} value={fmtMoney(rep.avgPaise)} />
              <Stat label={t('discountsGiven')} value={fmtMoney(rep.discountPaise)} />
            </Row>
            <T v="caption" c="ash">{t('salesDef')}</T>
          </Card>

          <Card>
            <T v="caption" c="ash">{t('paymentRecorded')}</T>
            <Row style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <Stat label={t('payCash')} value={fmtMoney(rep.pay.cash)} onPress={bills('&pay=cash')} />
              <Stat label={t('payUpi')} value={fmtMoney(rep.pay.upi)} note={t('notVerified')} onPress={bills('&pay=upi')} />
              <Stat label={t('payNone')} value={fmtMoney(rep.pay.none)} onPress={bills('&pay=none')} />
            </Row>
            <T v="caption" c="ash">{t('payDef')}</T>
          </Card>

          <Card>
            <T v="caption" c="ash">{t('profitTitle')}</T>
            {rep.profit.paise !== null ? (
              <T v="h3">{fmtMoney(rep.profit.paise)}</T>
            ) : (
              <>
                <T v="h3">{t('insufficient')}</T>
                <T c="ash">{rep.profit.lines ? t('profitMissing', { n: rep.profit.costlessLines, of: rep.profit.lines }) : t('noSalesInRange')}</T>
              </>
            )}
            <T v="caption" c="ash">{t('profitDef')}</T>
          </Card>

          {rep.reversed.count ? (
            <Card wash>
              <Stat label={t('reversedTitle')} value={`${rep.reversed.count} · ${fmtMoney(rep.reversed.paise)}`} note={t('reversedDef')} onPress={bills('&status=voided')} />
            </Card>
          ) : null}

          <Card>
            <T v="h3">{t('byDay')}</T>
            {rep.byDay.length === 0 ? <T c="ash">{t('noSalesInRange')}</T> : null}
            {rep.byDay.map((d) => (
              <Pressable
                key={d.day}
                accessibilityRole="button"
                accessibilityLabel={`${fmtDay(d.day)} ${fmtMoney(d.paise)}`}
                onPress={() => router.push(`/bills?from=${d.day}&to=${new Date(d.day).setDate(new Date(d.day).getDate() + 1)}`)}
                style={{ minHeight: 48, justifyContent: 'center', gap: 4 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T>{fmtDay(d.day)} · {t('billsCount', { n: d.bills })}</T>
                  <T v="sub">{fmtMoney(d.paise)}</T>
                </Row>
                <View style={{ height: 6, backgroundColor: C.bone }}>
                  <View style={{ height: 6, width: `${Math.max(2, (d.paise / top) * 100)}%`, backgroundColor: C.ink }} />
                </View>
              </Pressable>
            ))}
          </Card>

          <Card>
            <T v="h3">{t('bestSelling')}</T>
            <Choice value={by} onChange={setBy} row options={[['qty', t('byQty')], ['rev', t('byRevenue')]]} />
            {best.length === 0 ? <T c="ash">{t('noSalesInRange')}</T> : null}
            {best.map((x) => (
              <Pressable key={x.productId} accessibilityRole="button" onPress={open(x)} style={{ minHeight: 48, justifyContent: 'center' }}>
                <T v="sub" numberOfLines={1}>{x.name}</T>
                <T c="ash">{sold(x)}</T>
              </Pressable>
            ))}
          </Card>

          <Card>
            <T v="h3">{t('slowTitle')}</T>
            <T v="caption" c="ash">{t('noSalesList')}</T>
            {rep.noSales.length === 0 ? <T c="ash">{t('noneHere')}</T> : null}
            {rep.noSales.map((p) => (
              <Pressable key={p.id} accessibilityRole="button" onPress={() => router.push(`/product/${p.id}`)} style={{ minHeight: 48, justifyContent: 'center' }}>
                <T v="sub" numberOfLines={1}>{p.name}</T>
                <T c="ash">{t('stockLabel')} {qtyLabel(p.stock, p.unit)}</T>
              </Pressable>
            ))}
            {rep.lowSellers.length ? <T v="caption" c="ash" style={{ marginTop: 8 }}>{t('lowSellers')}</T> : null}
            {rep.lowSellers.map((x) => (
              <Pressable key={x.productId} accessibilityRole="button" onPress={open(x)} style={{ minHeight: 48, justifyContent: 'center' }}>
                <T v="sub" numberOfLines={1}>{x.name}</T>
                <T c="ash">{sold(x)}</T>
              </Pressable>
            ))}
          </Card>

          <Card>
            <T v="h3">{t('purchaseSpend')}</T>
            <Pressable accessibilityRole="button" onPress={() => router.push('/purchases')}>
              <T v="h3">{spend && spend.costed ? fmtMoney(spend.paise) : t('costUnknown')}</T>
            </Pressable>
            {spend && spend.uncosted ? <T c="ash">{t('uncostedReceipts', { n: spend.uncosted })}</T> : null}
            <T v="caption" c="ash">{t('spendDef')}</T>
          </Card>
        </>
      )}

      <Card>
        <T v="h3">{t('stockValue')}</T>
        <Pressable accessibilityRole="button" onPress={() => router.push('/inventory')}>
          <Row style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Stat label={t('valueAtCost')} value={value.costPaise || !value.unknownCost ? fmtMoney(value.costPaise) : t('costUnknown')} note={value.unknownCost ? t('costMissingN', { n: value.unknownCost }) : undefined} />
            <Stat label={t('valueAtPrice')} value={fmtMoney(value.sellPaise)} />
          </Row>
        </Pressable>
        <T v="caption" c="ash">{t('valueDef', { n: value.products })}</T>
      </Card>
    </Screen>
  );
}
