import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AdjustForm, EditForm, MovementRow } from '@/components/product';
import { RestockForm } from '@/components/restock';
import { useQtyLabel } from '@/components/sale';
import { Btn, Card, Empty, Row, Screen, T, Tag } from '@/components/ui';
import { fmtMoney, isActive, movementsFor, openList, stepFor, stockStatus, targetOf } from '@/lib/engine';
import { fmtDateTime, useT, useUnit } from '@/lib/i18n';
import { suggestOrder } from '@/lib/insights';
import { actions, flash, useApp } from '@/lib/store';

const Line = ({ label, value }: { label: string; value: string }) => (
  <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
    <T c="ash" style={{ flex: 1 }}>{label}</T>
    <T style={{ flex: 1.4, textAlign: 'right' }}>{value}</T>
  </Row>
);

/** One product: stock, rules, restock / adjust / edit, and its full movement history. */
export default function ProductDetail() {
  const t = useT();
  const unit = useUnit();
  const router = useRouter();
  const qtyLabel = useQtyLabel();
  const app = useApp();
  const { id, restock } = useLocalSearchParams<{ id: string; restock?: string }>();
  const p = app.products.find((x) => x.id === id);
  const [panel, setPanel] = useState<'restock' | 'adjust' | 'edit' | null>(restock ? 'restock' : null);
  const [shown, setShown] = useState(10);

  if (!p) return <Screen title={t('productsTitle')}><Empty title={t('noProduct')} /></Screen>;
  const st = stockStatus(p);
  const moves = movementsFor(app, p.id);
  const sug = suggestOrder(app, p);
  const target = targetOf(p);
  const onList = !!openList(app)?.lines.some((l) => l.productId === p.id);
  const close = () => setPanel(null);
  const toggle = (k: 'restock' | 'adjust' | 'edit') => setPanel((cur) => (cur === k ? null : k));

  return (
    <Screen title={p.name}>
      <Card>
        <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <T v="h1">{qtyLabel(p.stock, p.unit)}</T>
          <Tag label={st === 'OUT' ? t('outOfStock') : st === 'LOW' ? t('lowStock') : t('inStock')} kind={st === 'OUT' ? 'alert' : st === 'LOW' ? 'warn' : 'plain'} />
        </Row>
        {!isActive(p) ? <Tag label={t('archived')} /> : null}
        <Line label={t('sellingPrice')} value={`${fmtMoney(p.pricePaise)} / ${unit(p.unit)}`} />
        <Line label={t('purchaseCost')} value={p.costPaise === undefined ? t('costNotRecorded') : `${fmtMoney(p.costPaise)} / ${unit(p.unit)}`} />
        <Line label={t('lowThreshold')} value={qtyLabel(p.lowAt, p.unit)} />
        <Line label={t('targetStock')} value={`${qtyLabel(target.qty, p.unit)}${target.isDefault ? ` (${t('targetDefault')})` : ''}`} />
        {p.packQty ? <Line label={t('packSize')} value={qtyLabel(p.packQty, p.unit)} /> : null}
        {p.leadDays !== undefined ? <Line label={t('leadDays')} value={String(p.leadDays)} /> : null}
        {p.supplier ? <Line label={t('supplier')} value={p.supplier} /> : null}
        {p.notes ? <Line label={t('notes')} value={p.notes} /> : null}
        {p.barcodes.length ? <Line label={t('barcodeLabel')} value={p.barcodes.join(', ')} /> : null}
        <Line label={t('lastRestocked')} value={p.lastRestockedAt ? fmtDateTime(p.lastRestockedAt) : t('never')} />
      </Card>

      {st !== 'OK' ? (
        <Card wash>
          <T v="sub">{sug.qty > 0 ? t('suggestOrder', { qty: qtyLabel(sug.qty, p.unit) }) : t('noSuggestion')}</T>
          {sug.qty > 0 ? (
            <T v="caption" c="ash">
              {t('suggestMath', { target: qtyLabel(sug.target, p.unit), have: qtyLabel(sug.have, p.unit), onOrder: qtyLabel(sug.onOrder, p.unit) })}
            </T>
          ) : null}
        </Card>
      ) : null}

      <Row>
        <Btn label={t('restock')} kind={panel === 'restock' ? 'outline' : 'primary'} onPress={() => toggle('restock')} style={{ flex: 1 }} />
        <Btn
          kind="outline"
          label={onList ? `✓ ${t('onList')}` : t('addToList')}
          disabled={onList}
          onPress={() => {
            actions.addToList(p.id, sug.qty || stepFor(p.unit));
            flash(t('addedToList'));
          }}
          style={{ flex: 1 }}
        />
      </Row>
      <Row>
        <Btn kind="outline" label={t('adjustStock')} onPress={() => toggle('adjust')} style={{ flex: 1 }} />
        <Btn kind="outline" label={t('editDetails')} onPress={() => toggle('edit')} style={{ flex: 1 }} />
      </Row>

      {panel === 'restock' ? <RestockForm p={p} onDone={close} onCancel={close} /> : null}
      {panel === 'adjust' ? <AdjustForm p={p} onDone={close} /> : null}
      {panel === 'edit' ? <EditForm p={p} onDone={close} /> : null}

      <T v="h3">{t('moveHistory')}</T>
      {moves.length === 0 ? <T c="ash">{t('noMovements')}</T> : null}
      <View>
        {moves.slice(0, shown).map((m) => (
          <MovementRow key={m.id} m={m} unit={p.unit} />
        ))}
      </View>
      {moves.length > shown ? <Btn kind="outline" label={t('showMore')} onPress={() => setShown((n) => n + 20)} /> : null}

      <Btn
        kind="wash"
        label={isActive(p) ? t('archiveProduct') : t('restoreProduct')}
        onPress={() => {
          actions.updateProduct(p.id, { active: !isActive(p) });
          flash(t('savedOnPhone'));
          if (isActive(p)) router.back();
        }}
      />
      {isActive(p) ? <T v="caption" c="ash">{t('archiveNote')}</T> : null}
    </Screen>
  );
}
