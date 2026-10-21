import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { Btn, Card, Choice, Field, Screen, T } from '@/components/ui';
import { EngineError, parsePaise, parseQty, type Unit } from '@/lib/engine';
import { useT, useUnit } from '@/lib/i18n';
import { actions } from '@/lib/store';

export default function NewProduct() {
  const t = useT();
  const unit = useUnit();
  const router = useRouter();
  const params = useLocalSearchParams<{ barcode?: string; name?: string }>();
  const [name, setName] = useState(params.name ?? '');
  const [barcode, setBarcode] = useState(params.barcode ?? '');
  const [u, setU] = useState<Unit>('pcs');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [qty, setQty] = useState('0');
  const [low, setLow] = useState('5');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = () => {
    const e: Record<string, string> = {};
    const pricePaise = parsePaise(price);
    const costPaise = cost.trim() ? parsePaise(cost) : undefined;
    const openingQty = qty.trim() === '0' || !qty.trim() ? 0 : parseQty(qty);
    const lowAt = low.trim() === '0' || !low.trim() ? 0 : parseQty(low);
    if (!name.trim()) e.name = t('errName');
    if (pricePaise === null) e.price = t('errPrice');
    if (cost.trim() && costPaise === null) e.cost = t('errPrice');
    if (openingQty === null) e.qty = t('errQty');
    if (lowAt === null) e.low = t('errQty');
    if (Object.keys(e).length || pricePaise === null || openingQty === null || lowAt === null) return setErrors(e);
    try {
      actions.addProduct({ name, barcode, unit: u, pricePaise, costPaise: costPaise ?? undefined, openingQty, lowAt });
      router.back();
    } catch (err) {
      if (err instanceof EngineError && err.code === 'BARCODE_TAKEN') setErrors({ barcode: t('errBarcodeTaken', { name: err.detail ?? '' }) });
      else setErrors({ name: t('errSave') });
    }
  };

  return (
    <Screen title={t('registerTitle')} footer={<Btn label={t('saveProduct')} onPress={save} />}>
      <Card wash>
        <T v="sub">{t('newProductNote')}</T>
        <T c="ash">{t('newProductNoteHint')}</T>
      </Card>
      <Field label={t('productName')} value={name} onChangeText={setName} error={errors.name} />
      <Field label={t('barcodeOptional')} value={barcode} onChangeText={setBarcode} keyboardType="number-pad" error={errors.barcode} />
      <Choice label={t('unit')} value={u} onChange={setU} options={(['pcs', 'pkt', 'kg', 'L'] as Unit[]).map((x) => [x, unit(x)])} />
      <Field label={t('sellingPrice')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" error={errors.price} placeholder="0" />
      <Field label={t('costOptional')} value={cost} onChangeText={setCost} keyboardType="decimal-pad" error={errors.cost} placeholder="0" />
      <Field label={t('openingQty')} value={qty} onChangeText={setQty} keyboardType="decimal-pad" error={errors.qty} />
      <Field label={t('lowThreshold')} value={low} onChangeText={setLow} keyboardType="decimal-pad" error={errors.low} />
    </Screen>
  );
}
