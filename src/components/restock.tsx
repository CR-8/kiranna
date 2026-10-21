import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useQtyLabel } from '@/components/sale';
import { Btn, Card, Field, Row, T, Tag } from '@/components/ui';
import { C } from '@/constants/theme';
import { fmtMoney, openList, parsePaise, parseQtyIn, stepFor, type Product } from '@/lib/engine';
import { useT, useUnit } from '@/lib/i18n';
import type { AlertRow } from '@/lib/insights';
import { actions, flash, useApp } from '@/lib/store';

/** Known product → quantity → SAVE RESTOCK, all in one place (used by Stock, product detail and barcode scan). */
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

/** One flagged product: why it is flagged, how much to order (and the arithmetic), and what to do about it. */
export function AlertCard({ row }: { row: AlertRow }) {
  const t = useT();
  const router = useRouter();
  const qtyLabel = useQtyLabel();
  const app = useApp();
  const { p, level, sug, hidden } = row;
  const onList = !!openList(app)?.lines.some((l) => l.productId === p.id);
  const q = (milli: number) => qtyLabel(milli, p.unit);

  return (
    <Card style={{ borderWidth: level === 'OUT' ? 2 : 1, borderColor: level === 'OUT' ? C.ink : C.hairline }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={p.name} onPress={() => router.push(`/product/${p.id}`)} style={{ flex: 1 }}>
          <T v="sub" numberOfLines={2}>
            {p.name}
            {p.pack ? ` · ${p.pack}` : ''}
          </T>
        </Pressable>
        <Tag label={level === 'OUT' ? t('outOfStock') : t('lowStock')} kind={level === 'OUT' ? 'alert' : 'warn'} />
      </Row>
      <T c="ash">{level === 'OUT' ? t('whyOut', { min: q(p.lowAt) }) : t('whyLow', { have: q(p.stock), min: q(p.lowAt) })}</T>
      {sug.qty > 0 ? (
        <View>
          <T v="sub">{t('suggestOrder', { qty: q(sug.qty) })}</T>
          <T v="caption" c="ash">
            {t('suggestMath', { target: q(sug.target), have: q(sug.have), onOrder: q(sug.onOrder) })}
            {sug.targetIsDefault ? ` · ${t('targetDefault')}` : ''}
          </T>
        </View>
      ) : (
        <T c="ash">{sug.onOrder > 0 ? t('alreadyOnOrder', { qty: q(sug.onOrder) }) : t('noSuggestion')}</T>
      )}
      <Row>
        <Btn
          size="sm"
          label={onList ? `✓ ${t('onList')}` : t('addToList')}
          disabled={onList}
          onPress={() => {
            actions.addToList(p.id, sug.qty || stepFor(p.unit));
            flash(t('addedToList'));
          }}
          style={{ flex: 1 }}
        />
        <Btn size="sm" kind="outline" label={t('restock')} a11y={`${t('restock')} ${p.name}`} onPress={() => router.push(`/product/${p.id}?restock=1`)} style={{ flex: 1 }} />
      </Row>
      <Row>
        {hidden ? (
          <Btn size="sm" kind="wash" label={t('showAgain')} onPress={() => actions.setAlert(p.id, 'clear')} style={{ flex: 1 }} />
        ) : (
          <>
            <Btn size="sm" kind="wash" label={t('snooze')} onPress={() => actions.setAlert(p.id, 'snooze', 1)} style={{ flex: 1 }} />
            <Btn size="sm" kind="wash" label={t('dismiss')} onPress={() => actions.setAlert(p.id, 'dismiss')} style={{ flex: 1 }} />
          </>
        )}
      </Row>
      {hidden ? <T v="caption" c="ash">{t('hiddenNote')}</T> : <T v="caption" c="ash">{t('snoozeNote')}</T>}
    </Card>
  );
}
