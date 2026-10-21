import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { Btn, Choice, ErrorMessage, Field, Screen, T } from '@/components/ui';
import { EngineError, parsePaise, parseQtyIn, type Unit } from '@/lib/engine';
import { useT, useUnit } from '@/lib/i18n';
import { actions, flash } from '@/lib/store';

const UNITS: Unit[] = ['pcs', 'pkt', 'box', 'kg', 'g', 'L', 'ml'];
// Low-stock warning default when the shopkeeper does not set one: 5 whole units, or 500 g / 500 ml.
const autoLow = (u: Unit) => (u === 'g' || u === 'ml' ? 500_000 : 5000);

/** Name, unit, price, opening quantity. Everything else lives under MORE DETAILS. */
export default function NewProduct() {
  const t = useT();
  const unit = useUnit();
  const router = useRouter();
  const params = useLocalSearchParams<{ barcode?: string; name?: string }>();
  const [name, setName] = useState(params.name ?? '');
  const [u, setU] = useState<Unit>('pcs');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [more, setMore] = useState(false);
  const [barcode, setBarcode] = useState(params.barcode ?? '');
  const [cost, setCost] = useState('');
  const [low, setLow] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saving = useRef(false);

  const save = () => {
    if (saving.current) return;
    const e: Record<string, string> = {};
    const pricePaise = parsePaise(price);
    const costPaise = cost.trim() ? parsePaise(cost) : undefined;
    const zero = (s: string) => Number(s.trim().replace(',', '.')) === 0; // parseQtyIn rejects 0, but 0 is valid here
    const openingQty = !qty.trim() || zero(qty) ? 0 : parseQtyIn(qty, u);
    const lowAt = !low.trim() ? autoLow(u) : zero(low) ? 0 : parseQtyIn(low, u);
    if (!name.trim()) e.name = t('errName');
    if (pricePaise === null) e.price = t('errPrice');
    if (cost.trim() && costPaise === null) e.cost = t('errPrice');
    if (openingQty === null) e.qty = t('errQty');
    if (lowAt === null) e.low = t('errQty');
    if (!Object.keys(e).length) {
      saving.current = true;
      try {
        actions.addProduct({ name, barcode, unit: u, pricePaise: pricePaise!, costPaise: costPaise ?? undefined, openingQty: openingQty!, lowAt: lowAt! });
        flash(t('savedOnPhone'));
        return router.back();
      } catch (err) {
        saving.current = false;
        if (err instanceof EngineError && err.code === 'BARCODE_TAKEN') e.barcode = t('errBarcodeTaken', { name: err.detail ?? '' });
        else e.form = t('errSave');
      }
    }
    if (e.barcode || e.cost || e.low) setMore(true); // never leave an error inside a collapsed section
    setErrors(e);
  };

  return (
    <Screen title={t('registerTitle')} footer={<Btn label={t('saveProduct')} onPress={save} />}>
      {params.barcode ? <T c="ash">{t('barcodeLabel')}: {params.barcode}</T> : null}
      <Field label={t('productName')} value={name} onChangeText={setName} error={errors.name} autoFocus={!name} />
      <Choice label={t('unit')} value={u} onChange={setU} options={UNITS.map((x) => [x, unit(x)])} />
      <Field label={t('sellingPrice')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" error={errors.price} placeholder="0" />
      <Field label={t('openingQty')} value={qty} onChangeText={setQty} keyboardType={['g', 'kg', 'ml', 'L'].includes(u) ? 'default' : 'decimal-pad'} error={errors.qty} placeholder="0" />
      {more ? (
        <>
          <Field label={t('barcodeOptional')} value={barcode} onChangeText={setBarcode} keyboardType="number-pad" error={errors.barcode} />
          <Field label={t('costOptional')} value={cost} onChangeText={setCost} keyboardType="decimal-pad" error={errors.cost} placeholder="0" />
          <Field label={t('lowThreshold')} value={low} onChangeText={setLow} keyboardType="decimal-pad" error={errors.low} placeholder={String(autoLow(u) / 1000)} />
        </>
      ) : (
        <Btn kind="wash" label={t('moreDetails')} onPress={() => setMore(true)} />
      )}
      {errors.form ? <ErrorMessage text={errors.form} /> : null}
    </Screen>
  );
}
