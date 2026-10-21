import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { useQtyLabel } from '@/components/sale';
import { Btn, Card, ConfirmAction, Empty, ErrorMessage, Field, Row, Screen, T, Tag } from '@/components/ui';
import { C } from '@/constants/theme';
import { EngineError, fmtMoney, fmtQty, outstanding, parsePaise, parseQtyOrZero, uid, type Purchase } from '@/lib/engine';
import { fmtDateTime, useT, useUnit } from '@/lib/i18n';
import { actions, flash, useApp } from '@/lib/store';

type Inputs = Record<string, { qty: string; cost: string }>;

const startInputs = (p?: Purchase): Inputs =>
  Object.fromEntries((p?.lines ?? []).map((l) => [l.id, { qty: fmtQty(outstanding(l)), cost: l.costPaise === undefined ? '' : String(l.costPaise / 100) }]));

/**
 * Confirm what actually arrived. Quantities start at "everything still outstanding"; type less for a partial delivery
 * and the rest stays on order. Stock changes only when you confirm, and confirming twice does nothing extra.
 */
export default function PurchaseScreen() {
  const t = useT();
  const unit = useUnit();
  const router = useRouter();
  const qtyLabel = useQtyLabel();
  const app = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pur = app.purchases.find((x) => x.id === id);
  const [inp, setInp] = useState<Inputs>(() => startInputs(pur));
  const [error, setError] = useState('');
  const [cancel, setCancel] = useState(false);
  const receiptId = useRef(uid()); // one id per confirmation attempt: a repeated tap is recognised and ignored

  if (!pur) return <Screen title={t('purchases')}><Empty title={t('noPurchase')} /></Screen>;
  const open = pur.status === 'list' || pur.status === 'ordered';
  const set = (lineId: string, k: 'qty' | 'cost', v: string) => setInp((cur) => ({ ...cur, [lineId]: { ...cur[lineId], [k]: v } }));

  const confirm = () => {
    const lines: { lineId: string; qty: number; costPaise?: number }[] = [];
    for (const l of pur.lines) {
      const i = inp[l.id] ?? { qty: '', cost: '' };
      const qty = i.qty.trim() ? parseQtyOrZero(i.qty, l.unit) : 0;
      const costPaise = i.cost.trim() ? parsePaise(i.cost, true) : undefined;
      if (qty === null || (i.cost.trim() && costPaise === null)) return setError(t('errLine', { name: l.name }));
      if (qty > 0) lines.push({ lineId: l.id, qty, costPaise: costPaise ?? undefined });
    }
    try {
      actions.receive(pur.id, receiptId.current, lines);
      flash(t('goodsReceived'));
      router.back();
    } catch (e) {
      setError(e instanceof EngineError && e.code === 'EMPTY' ? t('errNothingReceived') : t('errSave'));
    }
  };

  return (
    <Screen
      title={t(pur.status === 'list' ? 'restockList' : 'purchase')}
      footer={open ? <Btn label={t('confirmReceived')} onPress={confirm} /> : undefined}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T c="ash">{fmtDateTime(pur.createdAt)}</T>
        <Tag label={t(`ps_${pur.status}`)} kind={pur.status === 'closed' ? 'active' : 'plain'} />
      </Row>
      {open ? <T c="ash">{t('receiveNote')}</T> : null}

      {pur.lines.map((l) => (
        <Card key={l.id}>
          <T v="sub">{l.name}</T>
          <T c="ash">
            {t('ordered')} {qtyLabel(l.qty, l.unit)} · {t('received')} {qtyLabel(l.received, l.unit)} · {t('outstanding')} {qtyLabel(outstanding(l), l.unit)}
          </T>
          {open ? (
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Field label={`${t('receivedNow')} (${unit(l.unit)})`} value={inp[l.id]?.qty ?? ''} onChangeText={(v) => set(l.id, 'qty', v)} keyboardType={['g', 'kg', 'ml', 'L'].includes(l.unit) ? 'default' : 'decimal-pad'} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={`${t('costPerUnit')} (₹)`} value={inp[l.id]?.cost ?? ''} onChangeText={(v) => set(l.id, 'cost', v)} keyboardType="decimal-pad" placeholder={t('optional')} />
              </View>
            </Row>
          ) : null}
        </Card>
      ))}
      {error ? <ErrorMessage text={error} /> : null}

      {pur.receipts.length ? <T v="h3">{t('receiptsTitle')}</T> : null}
      {pur.receipts.map((r) => (
        <View key={r.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: C.hairline }}>
          <T c="ash">{fmtDateTime(r.at)}</T>
          {r.lines.map((x) => {
            const l = pur.lines.find((y) => y.id === x.lineId);
            return (
              <T key={x.lineId}>
                {l?.name} · {l ? qtyLabel(x.qty, l.unit) : fmtQty(x.qty)}
                {x.costPaise !== undefined ? ` @ ${fmtMoney(x.costPaise)}` : ` · ${t('costNotRecorded')}`}
              </T>
            );
          })}
        </View>
      ))}

      {open ? (
        cancel ? (
          <ConfirmAction ask={t('cancelOrderAsk')} yes={t('cancelOrderYes')} no={t('keep')} onYes={() => { actions.cancelPurchase(pur.id); router.back(); }} onNo={() => setCancel(false)} />
        ) : (
          <Btn kind="wash" size="sm" label={t('cancelOrder')} onPress={() => setCancel(true)} />
        )
      ) : null}
    </Screen>
  );
}
