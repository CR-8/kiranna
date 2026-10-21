import { useRef, useState } from 'react';

import { useQtyLabel } from '@/components/sale';
import { Btn, Card, Field, Row, T } from '@/components/ui';
import { fmtMoney, parsePaise, parseQtyIn, type Product } from '@/lib/engine';
import { useT, useUnit } from '@/lib/i18n';
import { actions, flash } from '@/lib/store';

/** Known product → quantity → SAVE RESTOCK, all in one place (used by Stock and by barcode scan). */
export function RestockForm({ p, onDone, onCancel }: { p: Product; onDone: () => void; onCancel?: () => void }) {
  const t = useT();
  const unit = useUnit();
  const qtyLabel = useQtyLabel();
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saving = useRef(false);

  const add = parseQtyIn(qty, p.unit);
  const save = () => {
    if (saving.current) return;
    const costPaise = cost.trim() ? parsePaise(cost) : undefined;
    const e: Record<string, string> = {};
    if (add === null) e.qty = t('errQty');
    if (cost.trim() && costPaise === null) e.cost = t('errPrice');
    if (add === null || Object.keys(e).length) return setErrors(e);
    saving.current = true;
    actions.restock(p.id, add, costPaise ?? undefined);
    flash(t('savedOnPhone'));
    onDone();
  };

  return (
    <Card>
      <T v="h3">{p.name}</T>
      <T c="ash">
        {p.pack ? `${p.pack} · ` : ''}
        {fmtMoney(p.pricePaise)} / {unit(p.unit)} · {t('currentStock')}: {qtyLabel(p.stock, p.unit)}
      </T>
      <Field
        label={`${t('qtyToAdd')} (${unit(p.unit)})`}
        value={qty}
        onChangeText={setQty}
        keyboardType={['g', 'kg', 'ml', 'L'].includes(p.unit) ? 'default' : 'decimal-pad'}
        error={errors.qty}
        onSubmitEditing={save}
        autoFocus
      />
      {add ? <T v="sub">{t('newStockWill')} {qtyLabel(p.stock + add, p.unit)}</T> : null}
      {more ? (
        <Field label={t('costOptional')} value={cost} onChangeText={setCost} keyboardType="decimal-pad" error={errors.cost} placeholder="0" />
      ) : (
        <Btn kind="wash" size="sm" label={t('moreDetails')} onPress={() => setMore(true)} />
      )}
      <Row>
        {onCancel ? <Btn kind="outline" label={t('cancel')} onPress={onCancel} style={{ flex: 1 }} /> : null}
        <Btn label={t('saveRestock')} onPress={save} style={{ flex: 2 }} />
      </Row>
    </Card>
  );
}
