import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { useQtyLabel } from '@/components/sale';
import { Btn, Card, Empty, Field, Screen, T } from '@/components/ui';
import { fmtMoney, fmtQty, parsePaise, parseQty } from '@/lib/engine';
import { useT, useUnit } from '@/lib/i18n';
import { actions, useApp } from '@/lib/store';

export default function Restock() {
  const t = useT();
  const unit = useUnit();
  const router = useRouter();
  const qtyLabel = useQtyLabel();
  const app = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = app.products.find((x) => x.id === id);
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!p) return <Screen title={t('restockTitle')}><Empty title={t('noProduct')} /></Screen>;

  const add = parseQty(qty);
  const save = () => {
    const costPaise = cost.trim() ? parsePaise(cost) : undefined;
    const e: Record<string, string> = {};
    if (add === null) e.qty = t('errQty');
    if (cost.trim() && costPaise === null) e.cost = t('errPrice');
    if (add === null || Object.keys(e).length) return setErrors(e);
    actions.restock(p.id, add, costPaise ?? undefined);
    router.back();
  };

  return (
    <Screen title={t('restockTitle')} footer={<Btn label={t('saveRestock')} onPress={save} />}>
      <Card>
        <T v="h2">{p.name}</T>
        <T c="ash">
          {p.pack ? `${p.pack} · ` : ''}
          {unit(p.unit)} · {fmtMoney(p.pricePaise)}
          {p.barcodes[0] ? ` · ${p.barcodes[0]}` : ''}
        </T>
        <T v="caption" c="ash">{t('currentStock')}</T>
        <T v="h1">{qtyLabel(p.stock, p.unit)}</T>
      </Card>
      <Field label={`${t('qtyToAdd')} (${unit(p.unit)})`} value={qty} onChangeText={setQty} keyboardType="decimal-pad" error={errors.qty} autoFocus />
      <Field label={t('costOptional')} value={cost} onChangeText={setCost} keyboardType="decimal-pad" error={errors.cost} placeholder="0" />
      {add ? <T v="sub">{t('newStockWill')} {qtyLabel(p.stock + add, p.unit)}</T> : null}
      {add ? <T v="caption" c="ash">{fmtQty(p.stock)} + {fmtQty(add)}</T> : null}
    </Screen>
  );
}
