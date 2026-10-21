import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import { RestockForm } from '@/components/restock';
import { ProductRow, useQtyLabel } from '@/components/sale';
import { Btn, Card, Choice, Empty, ErrorMessage, Field, Row, Screen, T } from '@/components/ui';
import { C } from '@/constants/theme';
import { EngineError, fmtMoney, parsePaise, parseQtyIn, parseQtyOrZero, type Movement, type Product } from '@/lib/engine';
import { fmtDateTime, useT, useUnit } from '@/lib/i18n';
import { filterProducts, stockCounts, type StockFilter } from '@/lib/insights';
import { actions, flash, useApp } from '@/lib/store';

const measured = (p: Product) => ['g', 'kg', 'ml', 'L'].includes(p.unit);

/** Stock tab (`stock`): filters + restock. More ▸ Products (`catalogue`): everything, archived optional. */
export function ProductList({ mode }: { mode: 'stock' | 'catalogue' }) {
  const t = useT();
  const router = useRouter();
  const app = useApp();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [archived, setArchived] = useState(false);
  const [restocking, setRestocking] = useState<Product | null>(null);
  const counts = useMemo(() => stockCounts(app), [app]);
  const list = useMemo(
    () => (mode === 'stock' ? filterProducts(app, q, filter) : filterProducts(app, q, 'all', archived)),
    [app, q, filter, archived, mode],
  );
  const stock = mode === 'stock';

  if (restocking)
    return (
      <Screen title={t('restockTitle')} tab={stock ? 'stock' : 'more'}>
        <RestockForm p={restocking} onDone={() => setRestocking(null)} onCancel={() => setRestocking(null)} />
      </Screen>
    );

  return (
    <Screen title={stock ? t('stock') : t('productsTitle')} tab={stock ? 'stock' : 'more'} scroll={false}>
      {stock ? <Btn label={`${t('restockCenter')} (${counts.low + counts.out})`} onPress={() => router.push('/restock')} /> : null}
      <Row>
        <Btn kind={stock ? 'outline' : 'primary'} label={t('scanBarcode')} onPress={() => router.push('/scan')} style={{ flex: 1 }} />
        <Btn kind="outline" label={t('addProduct')} onPress={() => router.push('/product/new')} style={{ flex: 1 }} />
      </Row>
      <Field label={t('searchLabel')} placeholder={t('searchPlaceholder')} value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize="none" />
      {stock ? (
        <Choice<StockFilter>
          value={filter}
          onChange={setFilter}
          options={[
            ['all', `${t('fAll')} (${counts.all})`],
            ['in', `${t('inStock')} (${counts.in})`],
            ['low', `${t('lowStock')} (${counts.low})`],
            ['out', `${t('outOfStock')} (${counts.out})`],
          ]}
        />
      ) : (
        <Btn kind="wash" size="sm" label={archived ? t('hideArchived') : t('showArchived')} onPress={() => setArchived((v) => !v)} />
      )}
      <FlatList
        style={{ flex: 1 }}
        data={list}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty title={t('noProduct')} hint={t('noProductHint')} />}
        renderItem={({ item }) => (
          <ProductRow
            p={item}
            action={stock ? t('restock') : t('open')}
            onOpen={() => router.push(`/product/${item.id}`)}
            onPress={() => (stock ? setRestocking(item) : router.push(`/product/${item.id}`))}
          />
        )}
      />
    </Screen>
  );
}

const KIND_KEY = {
  opening: 'mvOpening',
  sale: 'mvSale',
  purchase: 'mvPurchase',
  return: 'mvReturn',
  damage: 'mvDamage',
  adjust: 'mvAdjust',
  reversal: 'mvReversal',
} as const;

/** One ledger line: when, what kind, signed quantity, and the reason if one was given. */
export function MovementRow({ m, unit }: { m: Movement; unit: Product['unit'] }) {
  const t = useT();
  const qtyLabel = useQtyLabel();
  return (
    <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: C.hairline }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="sub">{t(KIND_KEY[m.kind])}</T>
        <T v="sub">
          {m.qty > 0 ? '+' : '−'}
          {qtyLabel(Math.abs(m.qty), unit)}
        </T>
      </Row>
      <T c="ash">
        {fmtDateTime(m.at)}
        {m.reason ? ` · ${m.reason}` : ''}
        {m.costPaise !== undefined ? ` · ${fmtMoney(m.costPaise)}` : ''}
      </T>
    </View>
  );
}

type AdjustKind = 'damage' | 'adjust' | 'return';

/** Damaged/expired, recount, or customer return. Always lands in the movement history with its reason. */
export function AdjustForm({ p, onDone }: { p: Product; onDone: () => void }) {
  const t = useT();
  const unit = useUnit();
  const qtyLabel = useQtyLabel();
  const [kind, setKind] = useState<AdjustKind>('damage');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  // damage/return: how many; adjust: what is on the shelf now
  const n = kind === 'adjust' ? parseQtyOrZero(qty, p.unit) : parseQtyIn(qty, p.unit);
  const delta = n === null ? null : kind === 'damage' ? -n : kind === 'return' ? n : n - p.stock;

  const save = () => {
    if (delta === null) return setError(t('errQty'));
    if (delta === 0) return setError(t('errNoChange'));
    try {
      actions.adjustStock(p.id, delta, kind, reason);
      flash(t('savedOnPhone'));
      onDone();
    } catch (e) {
      setError(
        e instanceof EngineError && e.code === 'REASON' ? t('errReason') : e instanceof EngineError && e.code === 'STOCK' ? t('errTooMuch') : t('errSave'),
      );
    }
  };

  return (
    <Card>
      <Choice<AdjustKind>
        label={t('adjustWhat')}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setError('');
        }}
        options={[
          ['damage', t('adjDamage')],
          ['adjust', t('adjCount')],
          ['return', t('adjReturn')],
        ]}
      />
      <Field
        label={kind === 'adjust' ? `${t('countedNow')} (${unit(p.unit)})` : `${t('qtyShort')} (${unit(p.unit)})`}
        value={qty}
        onChangeText={setQty}
        keyboardType={measured(p) ? 'default' : 'decimal-pad'}
      />
      <Field label={kind === 'return' ? t('reasonOptional') : t('reasonRequired')} value={reason} onChangeText={setReason} placeholder={t('reasonExample')} />
      {delta ? <T v="sub">{t('newStockWill')} {qtyLabel(p.stock + delta, p.unit)}</T> : null}
      {error ? <ErrorMessage text={error} /> : null}
      <Btn label={t('saveAdjust')} onPress={save} />
    </Card>
  );
}

/** Price, cost and the restocking rules (minimum, target, pack size, lead time, supplier). Blank optional fields are cleared. */
export function EditForm({ p, onDone }: { p: Product; onDone: () => void }) {
  const t = useT();
  const unit = useUnit();
  const q = (m?: number) => (m === undefined ? '' : String(m / 1000));
  const rs = (x?: number) => (x === undefined ? '' : String(x / 100));
  const [price, setPrice] = useState(rs(p.pricePaise));
  const [cost, setCost] = useState(rs(p.costPaise));
  const [low, setLow] = useState(q(p.lowAt));
  const [target, setTarget] = useState(q(p.targetAt));
  const [pack, setPack] = useState(q(p.packQty));
  const [lead, setLead] = useState(p.leadDays === undefined ? '' : String(p.leadDays));
  const [supplier, setSupplier] = useState(p.supplier ?? '');
  const [notes, setNotes] = useState(p.notes ?? '');
  const [alias, setAlias] = useState(p.barcodes.slice(1).join(', '));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = () => {
    const e: Record<string, string> = {};
    const pricePaise = parsePaise(price);
    const costPaise = cost.trim() ? parsePaise(cost, true) : null;
    const lowAt = parseQtyOrZero(low, p.unit);
    const targetAt = target.trim() ? parseQtyOrZero(target, p.unit) : null;
    const packQty = pack.trim() ? parseQtyIn(pack, p.unit) : null;
    const leadDays = lead.trim() ? Number(lead) : null;
    if (pricePaise === null) e.price = t('errPrice');
    if (cost.trim() && costPaise === null) e.cost = t('errPrice');
    if (lowAt === null) e.low = t('errQty');
    if (target.trim() && targetAt === null) e.target = t('errQty');
    if (pack.trim() && packQty === null) e.pack = t('errQty');
    if (leadDays !== null && !(Number.isFinite(leadDays) && leadDays >= 0)) e.lead = t('errQty');
    if (Object.keys(e).length) return setErrors(e);
    try {
      actions.updateProduct(p.id, {
        pricePaise: pricePaise!,
        costPaise,
        lowAt: lowAt!,
        targetAt,
        packQty,
        leadDays,
        supplier: supplier.trim() || null,
        notes: notes.trim() || null,
        barcodes: [...p.barcodes.slice(0, 1), ...alias.split(/[,\s]+/).filter(Boolean)],
      });
      flash(t('savedOnPhone'));
      onDone();
    } catch (err) {
      setErrors({ form: err instanceof EngineError && err.code === 'BARCODE_TAKEN' ? t('errBarcodeTaken', { name: err.detail ?? '' }) : t('errSave') });
    }
  };

  return (
    <Card>
      <Field label={t('sellingPrice')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" error={errors.price} />
      <Field label={t('costOptional')} value={cost} onChangeText={setCost} keyboardType="decimal-pad" error={errors.cost} hint={t('costBlankHint')} />
      <Field label={`${t('lowThreshold')} (${unit(p.unit)})`} value={low} onChangeText={setLow} keyboardType="decimal-pad" error={errors.low} />
      <Field label={`${t('targetStock')} (${unit(p.unit)})`} value={target} onChangeText={setTarget} keyboardType="decimal-pad" error={errors.target} placeholder={q(p.lowAt * 3)} hint={t('targetHint')} />
      <Field label={`${t('packSize')} (${unit(p.unit)})`} value={pack} onChangeText={setPack} keyboardType="decimal-pad" error={errors.pack} hint={t('packHint')} />
      <Field label={t('leadDays')} value={lead} onChangeText={setLead} keyboardType="number-pad" error={errors.lead} placeholder="2" />
      <Field label={t('supplier')} value={supplier} onChangeText={setSupplier} />
      <Field label={t('notes')} value={notes} onChangeText={setNotes} />
      <Field label={t('barcodeAliases')} value={alias} onChangeText={setAlias} keyboardType="number-pad" />
      {errors.form ? <ErrorMessage text={errors.form} /> : null}
      <Btn label={t('saveChanges')} onPress={save} />
    </Card>
  );
}
