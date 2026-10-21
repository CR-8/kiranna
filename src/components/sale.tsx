import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Btn, Empty, QuantityStepper, Row, Screen, T } from '@/components/ui';
import { C } from '@/constants/theme';
import { fmtMoney, fmtQty, lineTotal, saleTotal, stockStatus, type Product, type SaleItem, type Unit } from '@/lib/engine';
import { useT, useUnit } from '@/lib/i18n';
import { useApp } from '@/lib/store';

/** The open draft for the current /sale/[id]/* route, or undefined once it is confirmed/discarded. */
export function useDraft() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const sale = app.sales.find((s) => s.id === id);
  return { id, app, sale: sale?.status === 'draft' ? sale : undefined };
}

export function NoSale({ title }: { title: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <Screen title={title}>
      <Empty title={t('saleGone')} hint={t('saleGoneHint')} />
      <Btn label={t('goHome')} onPress={() => router.replace('/')} />
    </Screen>
  );
}

/** "2 pkt", "0.5 kg" */
export function useQtyLabel() {
  const unit = useUnit();
  return (milli: number, u: Unit) => `${fmtQty(milli)} ${unit(u)}`;
}

const rowLine = { paddingVertical: 10, borderBottomWidth: 1, borderColor: C.hairline } as const;

/** Compact catalog row: name + size, price, stock; one clear action on the right. */
export function ProductRow({ p, action, onPress }: { p: Product; action: string; onPress: () => void }) {
  const t = useT();
  const unit = useUnit();
  const qtyLabel = useQtyLabel();
  const st = stockStatus(p);
  const stock = st === 'OUT' ? t('outOfStock') : `${t('stockLabel')} ${qtyLabel(p.stock, p.unit)}${st === 'LOW' ? ` · ${t('lowStock')}` : ''}`;
  return (
    <Row style={rowLine}>
      <View style={{ flex: 1 }}>
        <T v="sub" numberOfLines={2}>
          {p.name}
          {p.pack ? ` · ${p.pack}` : ''}
        </T>
        <T c="ash">
          {fmtMoney(p.pricePaise)} / {unit(p.unit)} · {stock}
        </T>
      </View>
      <Btn size="sm" kind="outline" label={action} a11y={`${action} ${p.name}`} onPress={onPress} style={{ minWidth: 96 }} />
    </Row>
  );
}

/** One bill line, editable in place: quantity stepper, replace, remove. */
export function BillItemRow({
  item,
  onQty,
  onReplace,
  onRemove,
}: {
  item: SaleItem;
  onQty: (q: number) => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const unit = useUnit();
  return (
    <View style={[rowLine, { gap: 8 }]}>
      <Row style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <T v="sub" numberOfLines={2}>{item.name}</T>
          <T c="ash">
            {fmtMoney(item.unitPaise)} / {unit(item.unit)}
          </T>
        </View>
        <T v="h3">{fmtMoney(lineTotal(item.unitPaise, item.qty))}</T>
      </Row>
      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        <QuantityStepper qty={item.qty} unit={item.unit} onChange={onQty} />
        <Btn size="sm" kind="wash" label={t('replace')} a11y={`${t('replace')} ${item.name}`} onPress={onReplace} style={{ flexGrow: 1, minWidth: 84, flexBasis: 84 }} />
        <Btn size="sm" kind="outline" label="✕" a11y={`${t('remove')} ${item.name}`} onPress={onRemove} style={{ width: 48 }} />
      </Row>
    </View>
  );
}

/** Running total + the screen's single primary action, kept in the stable footer. */
export function BillTotalBar({ items, children }: { items: SaleItem[]; children: ReactNode }) {
  const t = useT();
  return (
    <Row style={{ gap: 16 }}>
      <View accessible accessibilityLabel={`${t('total')} ${fmtMoney(saleTotal(items))}`}>
        <T v="caption" c="ash">{t('total')} · {t('itemsCount', { n: items.length })}</T>
        <T v="h2">{fmtMoney(saleTotal(items))}</T>
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Row>
  );
}
